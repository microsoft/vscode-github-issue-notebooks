/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import AbortController from "abort-controller";
import { TextDecoder, TextEncoder } from "util";
import * as vscode from 'vscode';
import { SearchIssuesAndPullRequestsResponseItemsItem } from '../common/types';
import { OctokitProvider } from "./octokitProvider";
import { NodeType, Utils } from "./parser/nodes";
import { ProjectContainer } from './project';
import { isRunnable, isUsingAtMe } from './utils';


export interface NotebookCellExecutionSummary {
	success?: boolean;
	duration?: number;
	executionOrder?: number;
	message?: string;
}

export interface INotebookCellExecution {

	readonly cell: vscode.NotebookCell;
	readonly token: vscode.CancellationToken;

	start(context?: { executionOrder?: number; }): void;
	resolve(result: NotebookCellExecutionSummary): void;

	clearOutput(): void;
	appendOutput(out: vscode.NotebookCellOutput[]): void;
	replaceOutput(out: vscode.NotebookCellOutput[]): void;
	appendOutputItems(outputId: string, items: vscode.NotebookCellOutputItem[]): void;
	replaceOutputItems(outputId: string, items: vscode.NotebookCellOutputItem[]): void;
}

interface RawCellOutput {
	mime: string;
	value: any;
}

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.NotebookCellKind;
	editable?: boolean;
}

type OutputMetadataShape = Partial<{ startTime: number, isPersonal: boolean; }>;

class IssuesNotebookKernel implements vscode.NotebookKernel {

	readonly id = 'githubIssueKernel';
	readonly label: string = 'GitHub Issues Kernel';
	readonly supportedLanguages: string[] = ['github-issues'];

	private _executionOrder = 0;

	constructor(
		readonly container: ProjectContainer,
		readonly octokit: OctokitProvider
	) { }

	async executeCellsRequest(document: vscode.NotebookDocument, ranges: vscode.NotebookCellRange[]) {
		const cells: vscode.NotebookCell[] = [];
		for (let range of ranges) {
			for (let i = range.start; i < range.end; i++) {
				cells.push(document.cells[i]);
			}
		}
		this._executeCells(cells);
	}

	private async _executeCells(cells: vscode.NotebookCell[]): Promise<void> {

		const all = new Set<vscode.NotebookCell>();

		for (const cell of cells) {
			this._collectDependentCells(cell, all);
		}

		const tasks = Array.from(all).map(cell => vscode.notebook.createNotebookCellExecutionTask(cell.notebook.uri, cell.index, this.id)!);
		for (const task of tasks) {
			await this._doExecuteCell(task);
		}
	}

	private async _doExecuteCell(execution: vscode.NotebookCellExecutionTask): Promise<void> {

		const doc = await vscode.workspace.openTextDocument(execution.cell.document.uri);
		const project = this.container.lookupProject(doc.uri);
		const query = project.getOrCreate(doc);

		// update query so that symbols defined here are marked as more recent
		project.symbols.update(query);

		execution.executionOrder = ++this._executionOrder;
		execution.start({ startTime: Date.now() });

		// await new Promise(resolve => setTimeout(resolve, 3000));

		if (!isRunnable(query)) {
			execution.end({ success: true });
			return;
		}

		const metadata: OutputMetadataShape = {
			isPersonal: isUsingAtMe(query),
			startTime: Date.now()
		};

		const allQueryData = project.queryData(query);
		let allItems: SearchIssuesAndPullRequestsResponseItemsItem[] = [];
		let tooLarge = false;
		// fetch
		try {
			const abortCtl = new AbortController();
			execution.token.onCancellationRequested(_ => abortCtl.abort());

			for (let queryData of allQueryData) {
				const octokit = await this.octokit.lib();

				let page = 1;
				let count = 0;
				while (!execution.token.isCancellationRequested) {

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
			execution.replaceOutput([new vscode.NotebookCellOutput([
				new vscode.NotebookCellOutputItem('application/x.notebook.error-traceback', {
					ename: err instanceof Error && err.name || 'error',
					evalue: err instanceof Error && err.message || JSON.stringify(err, undefined, 4),
					traceback: []
				})
			])]);
			execution.end({ success: false });
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
		execution.replaceOutput([new vscode.NotebookCellOutput([
			new vscode.NotebookCellOutputItem(IssuesNotebookProvider.mimeGithubIssues, allItems),
			new vscode.NotebookCellOutputItem('text/markdown', md),
		], metadata)]);

		execution.end({ success: true });
	}


	private async _collectDependentCells(cell: vscode.NotebookCell, bucket: Set<vscode.NotebookCell>): Promise<void> {

		const project = this.container.lookupProject(cell.notebook.uri);
		const query = project.getOrCreate(cell.document);

		const seen = new Set<string>();
		const stack = [query];

		while (true) {
			const query = stack.pop();
			if (!query) {
				break;
			}
			if (seen.has(query.id)) {
				continue;
			}
			seen.add(query.id);

			Utils.walk(query, node => {
				if (node._type === NodeType.VariableName) {
					const symbol = project.symbols.getFirst(node.value);
					if (symbol) {
						stack.push(symbol.root);
					}
				}
			});
		}

		for (const candidate of cell.notebook.cells) {
			if (seen.has(candidate.document.uri.toString())) {
				bucket.add(candidate);
			}
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
		edit.replaceNotebookCellMetadata(cell.notebook.uri, cell.index, cell.metadata.with({ editable: !locked }));
		return vscode.workspace.applyEdit(edit);
	}

	setDocumentLockState(notebook: vscode.NotebookDocument, locked: boolean) {
		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookMetadata(notebook.uri, notebook.metadata.with({ editable: !locked, cellEditable: !locked }));
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

		const cells = raw.map(item => new vscode.NotebookCellData(
			item.kind,
			item.value,
			item.language,
			undefined,
			new vscode.NotebookCellMetadata().with({ editable: item.editable ?? true })
		));

		return new vscode.NotebookData(
			cells,
			new vscode.NotebookDocumentMetadata().with({ cellHasExecutionOrder: true, })
		);
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
				kind: cell.kind,
				language: cell.document.languageId,
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
