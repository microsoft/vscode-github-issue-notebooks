/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import AbortController from "abort-controller";
import { TextDecoder, TextEncoder } from "util";
import * as vscode from 'vscode';
import { SearchIssuesAndPullRequestsResponseItemsItem } from '../common/types';
import { OctokitProvider } from "./octokitProvider";
import { ProjectContainer } from './project';
import { isRunnable } from './utils';

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.CellKind;
	editable?: boolean;
}

class NotebookCellExecution {

	private static _tokenPool = 0;
	private static _tokens = new WeakMap<vscode.NotebookCell, number>();

	private readonly _token: number = NotebookCellExecution._tokenPool++;

	private readonly _originalRunState: vscode.NotebookCellRunState | undefined;
	private readonly _startTime: number = Date.now();

	readonly cts = new vscode.CancellationTokenSource();

	constructor(readonly cell: vscode.NotebookCell) {
		NotebookCellExecution._tokens.set(this.cell, this._token);
		this._originalRunState = cell.metadata.runState;
		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookCellMetadata(this.cell.notebook.uri, this.cell.index, {
			runState: vscode.NotebookCellRunState.Running,
			runStartTime: this._startTime,
			statusMessage: undefined,
		});
		vscode.workspace.applyEdit(edit);
	}

	private _isLatest(): boolean {
		// these checks should be provided by VS Code
		return NotebookCellExecution._tokens.get(this.cell) === this._token;
	}

	cancel(): void {
		if (this._isLatest()) {
			this.cts.cancel();
			NotebookCellExecution._tokens.delete(this.cell);
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCellMetadata(this.cell.notebook.uri, this.cell.index, { runState: this._originalRunState });
			vscode.workspace.applyEdit(edit);
		}
	}

	resolve(outputs: vscode.NotebookCellOutput[], message?: string): void {
		if (this._isLatest()) {
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCellMetadata(this.cell.notebook.uri, this.cell.index, {
				executionOrder: this._token,
				runState: vscode.NotebookCellRunState.Success,
				lastRunDuration: Date.now() - this._startTime,
				statusMessage: message,
			});
			edit.replaceNotebookCellOutput(this.cell.notebook.uri, this.cell.index, outputs);
			vscode.workspace.applyEdit(edit);
		}
	}

	reject(err: any): void {
		if (this._isLatest()) {
			// print as error
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCellMetadata(this.cell.notebook.uri, this.cell.index, {
				executionOrder: this._token,
				statusMessage: 'Error',
				lastRunDuration: undefined,
				runState: vscode.NotebookCellRunState.Error,
			});
			edit.replaceNotebookCellOutput(this.cell.notebook.uri, this.cell.index, [new vscode.NotebookCellOutput([
				new vscode.NotebookCellOutputItem('application/x.notebook.error-traceback', {
					ename: err instanceof Error && err.name || 'error',
					evalue: err instanceof Error && err.message || JSON.stringify(err, undefined, 4),
					traceback: []
				})
			])]);
			vscode.workspace.applyEdit(edit);
		}
	}

	dispose() {
		this.cts.dispose();
	}
}

class NotebookDocumentExecution {

	private static _tokenPool = 0;
	private static _tokens = new WeakMap<vscode.NotebookDocument, number>();

	private readonly _token: number = NotebookDocumentExecution._tokenPool++;

	private readonly _originalRunState: vscode.NotebookRunState | undefined;

	readonly cts = new vscode.CancellationTokenSource();

	constructor(readonly document: vscode.NotebookDocument) {
		NotebookDocumentExecution._tokens.set(this.document, this._token);
		this._originalRunState = document.metadata.runState;
		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookMetadata(document.uri, { runState: vscode.NotebookRunState.Running, });
		vscode.workspace.applyEdit(edit);
	}

	private _isLatest(): boolean {
		// these checks should be provided by VS Code
		return NotebookDocumentExecution._tokens.get(this.document) === this._token;
	}

	cancel(): void {
		if (this._isLatest()) {
			this.cts.cancel();
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookMetadata(this.document.uri, { runState: this._originalRunState });
			vscode.workspace.applyEdit(edit);
			NotebookDocumentExecution._tokens.delete(this.document);
		}
	}

	resolve(): void {
		if (this._isLatest()) {
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookMetadata(this.document.uri, { runState: vscode.NotebookRunState.Idle });
			vscode.workspace.applyEdit(edit);
		}
	}

	dispose(): void {
		this.cts.dispose();
	}
}

class IssuesNotebookKernel implements vscode.NotebookKernel {

	readonly id = 'githubIssueKernel';
	readonly label: string = 'GitHub Issues Kernel';

	// description?: string | undefined;
	// detail?: string | undefined;
	// isPreferred?: boolean | undefined;
	// preloads?: vscode.Uri[] | undefined;

	private readonly _cellExecutions = new WeakMap<vscode.NotebookCell, NotebookCellExecution>();
	private readonly _documentExecutions = new WeakMap<vscode.NotebookDocument, NotebookDocumentExecution>();

	constructor(
		readonly container: ProjectContainer,
		readonly octokit: OctokitProvider
	) { }

	async executeAllCells(document: vscode.NotebookDocument): Promise<void> {
		this.cancelAllCellsExecution(document);

		const execution = new NotebookDocumentExecution(document);
		this._documentExecutions.set(document, execution);

		try {
			let currentCell: vscode.NotebookCell;

			execution.cts.token.onCancellationRequested(() => this.cancelCellExecution(document, currentCell));

			for (let cell of document.cells) {
				if (cell.cellKind === vscode.CellKind.Code) {
					currentCell = cell;
					await this.executeCell(document, cell);

					if (execution.cts.token.isCancellationRequested) {
						break;
					}
				}
			}
		} finally {
			execution.resolve();
			execution.dispose();
		}
	}

	async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell): Promise<void> {
		this.cancelCellExecution(document, cell);

		const execution = new NotebookCellExecution(cell);
		this._cellExecutions.set(cell, execution);

		const d1 = vscode.notebook.onDidChangeNotebookCells(e => {
			if (e.document !== document) {
				return;
			}
			const didChange = e.changes.some(change => change.items.includes(cell) || change.deletedItems.includes(cell));
			if (didChange) {
				execution.cancel();
			}
		});

		const d2 = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document === cell.document) {
				execution.cancel();
			}
		});

		try {
			return await this._doExecuteCell(execution);
		} finally {
			d1.dispose();
			d2.dispose();
			execution.dispose();
		}
	}

	private async _doExecuteCell(execution: NotebookCellExecution): Promise<void> {

		const doc = await vscode.workspace.openTextDocument(execution.cell.uri);
		const project = this.container.lookupProject(doc.uri);
		const query = project.getOrCreate(doc);

		// update query so that symbols defined here are marked as more recent
		project.symbols.update(query);

		if (!isRunnable(query)) {
			execution.resolve([]);
			return;
		}

		const allQueryData = project.queryData(query);
		let allItems: SearchIssuesAndPullRequestsResponseItemsItem[] = [];
		let tooLarge = false;
		// fetch
		try {
			const abortCtl = new AbortController();
			execution.cts.token.onCancellationRequested(_ => abortCtl.abort());

			for (let queryData of allQueryData) {
				const octokit = await this.octokit.lib();

				let page = 1;
				let count = 0;
				while (!execution.cts.token.isCancellationRequested) {

					const response = await octokit.search.issuesAndPullRequests({
						q: queryData.q,
						sort: (<any>queryData.sort),
						order: queryData.order,
						per_page: 100,
						page,
						request: { signal: abortCtl.signal }
					});
					count += response.data.items.length;
					allItems = allItems.concat(<any>response.data.items);
					tooLarge = tooLarge || response.data.total_count > 1000;
					if (count >= Math.min(1000, response.data.total_count)) {
						break;
					}
					page += 1;
				}
			}
		} catch (err) {
			// print as error
			execution.reject(err);
			return;
		}

		// sort
		const [first] = allQueryData;
		const comparator = allQueryData.length >= 2 && allQueryData.every(item => item.sort === first.sort) && cmp.byName.get(first.sort!);
		if (comparator) {
			allItems.sort(first.sort === 'asc' ? cmp.invert(comparator) : comparator);
		}

		// "render"
		const seen = new Set<string>();
		let md = '';
		for (let item of allItems) {
			if (seen.has(item.url)) {
				continue;
			}
			seen.add(item.url);

			// markdown
			md += `- [#${item.number}](${item.html_url} "${item.title}") ${item.title} [${item.labels.map(label => `${label.name}`).join(', ')}]`;
			if (item.assignee) {
				md += `- [@${item.assignee.login}](${item.assignee.html_url} "Issue ${item.number} is assigned to ${item.assignee.login}")\n`;
			}
			md += '\n';
		}

		// status line
		if (allItems.length) {
			execution.resolve([new vscode.NotebookCellOutput([
				new vscode.NotebookCellOutputItem('text/markdown', md),
				new vscode.NotebookCellOutputItem(IssuesNotebookProvider.mimeGithubIssues, allItems),
			])]);
		} else {
			execution.resolve([], 'No results');
		}
	}

	async cancelCellExecution(_document: vscode.NotebookDocument, cell: vscode.NotebookCell): Promise<void> {
		const execution = this._cellExecutions.get(cell);
		if (execution) {
			execution.cancel();
		}
	}

	async cancelAllCellsExecution(document: vscode.NotebookDocument): Promise<void> {
		const execution = this._documentExecutions.get(document);
		if (execution) {
			execution.cancel();
		}
	}
}

export class IssuesNotebookProvider implements vscode.NotebookContentProvider, vscode.NotebookKernelProvider {

	static mimeGithubIssues = 'x-application/github-issues';

	private readonly _localDisposables: vscode.Disposable[] = [];
	private readonly _cellStatusBarItems = new WeakMap<vscode.NotebookCell, vscode.NotebookCellStatusBarItem>();

	constructor(
		readonly container: ProjectContainer,
		readonly octokit: OctokitProvider
	) {
		this._localDisposables.push(vscode.notebook.onDidChangeCellOutputs(e => {

			for (let cell of e.cells) {
				if (cell.outputs.length > 0) {

					let issues: { html_url: string; }[] | undefined;
					out: for (let output of cell.outputs) {
						for (let item of output.outputs) {
							if (item.mime === IssuesNotebookProvider.mimeGithubIssues) {
								issues = item.value as { html_url: string; }[];
								break out;
							}
						}
					}

					if (issues) {
						const item = this._cellStatusBarItems.get(cell) ?? vscode.notebook.createCellStatusBarItem(cell, vscode.NotebookCellStatusBarAlignment.Right);
						this._cellStatusBarItems.set(cell, item);
						item.command = 'github-issues.openAll';
						item.text = `$(globe) Open ${issues.length} results`;
						item.tooltip = `Open ${issues.length} results in browser`;
						item.show();
					}

				} else {
					const item = this._cellStatusBarItems.get(cell);
					if (item) {
						item.dispose();
						this._cellStatusBarItems.delete(cell);
					}
				}
			}
		}));
	}

	dispose() {
		this._localDisposables.forEach(d => d.dispose());
	}

	provideKernels() {
		return [new IssuesNotebookKernel(this.container, this.octokit)];
	}

	async resolveNotebook(_document: vscode.NotebookDocument, _webview: { readonly onDidReceiveMessage: vscode.Event<any>; postMessage(message: any): Thenable<boolean>; asWebviewUri(localResource: vscode.Uri): vscode.Uri; }): Promise<void> {
		// nothing
	}

	// -- utils

	setCellLockState(cell: vscode.NotebookCell, locked: boolean) {
		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookCellMetadata(cell.notebook.uri, cell.index, { ...cell.metadata, editable: !locked });
		return vscode.workspace.applyEdit(edit);
	}

	setDocumentLockState(notebook: vscode.NotebookDocument, locked: boolean) {
		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookMetadata(notebook.uri, { ...notebook.metadata, editable: !locked, cellEditable: !locked });
		return vscode.workspace.applyEdit(edit);
	}

	// -- IO

	async openNotebook(uri: vscode.Uri, context: vscode.NotebookDocumentOpenContext): Promise<vscode.NotebookData> {
		let actualUri = context.backupId ? vscode.Uri.parse(context.backupId) : uri;
		let contents = '';
		try {
			contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(actualUri));
		} catch {
		}

		let raw: RawNotebookCell[];
		try {
			raw = <RawNotebookCell[]>JSON.parse(contents);
		} catch {
			//?
			raw = [];
		}

		const notebookData: vscode.NotebookData = {
			languages: ['github-issues'],
			metadata: {
				cellRunnable: true,
				cellHasExecutionOrder: true,
				displayOrder: [IssuesNotebookProvider.mimeGithubIssues, 'text/markdown']
			},
			cells: raw.map(item => ({
				source: item.value,
				language: item.language,
				cellKind: item.kind,
				outputs: [],
				metadata: { editable: item.editable ?? true, runnable: true }
			}))
		};

		return notebookData;
	}

	saveNotebook(document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
		return this._save(document, document.uri);
	}

	saveNotebookAs(targetResource: vscode.Uri, document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
		return this._save(document, targetResource);
	}

	async backupNotebook(document: vscode.NotebookDocument, context: vscode.NotebookDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.NotebookDocumentBackup> {
		await this._save(document, context.destination);
		return {
			id: context.destination.toString(),
			delete: () => vscode.workspace.fs.delete(context.destination)
		};
	}

	async _save(document: vscode.NotebookDocument, targetResource: vscode.Uri): Promise<void> {
		let contents: RawNotebookCell[] = [];
		for (let cell of document.cells) {
			contents.push({
				kind: cell.cellKind,
				language: cell.language,
				value: cell.document.getText(),
				editable: cell.metadata.editable
			});
		}
		await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(JSON.stringify(contents, undefined, 2)));
	}
}

namespace cmp {

	export type ItemComparator = (a: SearchIssuesAndPullRequestsResponseItemsItem, b: SearchIssuesAndPullRequestsResponseItemsItem) => number;

	export const byName = new Map([
		['comments', compareByComments],
		['created', compareByCreated],
		['updated', compareByUpdated],
	]);

	export function invert<T>(compare: (a: T, b: T) => number) {
		return (a: T, b: T) => compare(a, b) * -1;
	}

	export function compareByComments(a: SearchIssuesAndPullRequestsResponseItemsItem, b: SearchIssuesAndPullRequestsResponseItemsItem): number {
		return a.comments - b.comments;
	}

	export function compareByCreated(a: SearchIssuesAndPullRequestsResponseItemsItem, b: SearchIssuesAndPullRequestsResponseItemsItem): number {
		return Date.parse(a.created_at) - Date.parse(b.created_at);
	}

	export function compareByUpdated(a: SearchIssuesAndPullRequestsResponseItemsItem, b: SearchIssuesAndPullRequestsResponseItemsItem): number {
		return Date.parse(a.updated_at) - Date.parse(b.updated_at);
	}
}
