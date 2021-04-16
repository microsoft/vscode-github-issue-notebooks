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
import { isRunnable } from './utils';


export const mimeGithubIssues = 'x-application/github-issues';

// --- running queries

export class IssuesNotebookKernel {

	private readonly _controller: vscode.NotebookController;
	private _executionOrder = 0;

	constructor(
		readonly container: ProjectContainer,
		readonly octokit: OctokitProvider
	) {

		this._controller = vscode.notebook.createNotebookController({
			id: 'githubIssueKernel',
			label: 'GitHub',
			description: 'github.com',
			supportedLanguages: ['github-issues'],
			selector: { viewType: 'github-issues' },
			hasExecutionOrder: true,
			executeHandler: this._executeAll.bind(this)
		});
	}

	dispose(): void {
		this._controller.dispose();
	}

	private _executeAll(cells: vscode.NotebookCell[]): void {
		const all = new Set<vscode.NotebookCell>();
		for (const cell of cells) {
			this._collectDependentCells(cell, all);
		}
		for (const cell of all.values()) {
			this._doExecuteCell(cell);
		}
	}

	private async _doExecuteCell(cell: vscode.NotebookCell): Promise<void> {

		const doc = await vscode.workspace.openTextDocument(cell.document.uri);
		const project = this.container.lookupProject(doc.uri);
		const query = project.getOrCreate(doc);

		// update query so that symbols defined here are marked as more recent
		project.symbols.update(query);

		const exec = this._controller.createNotebookCellExecutionTask(cell);
		exec.executionOrder = ++this._executionOrder;
		exec.start({ startTime: Date.now() });


		if (!isRunnable(query)) {
			exec.end({ success: true });
			return;
		}

		const allQueryData = project.queryData(query);
		let allItems: SearchIssuesAndPullRequestsResponseItemsItem[] = [];
		let tooLarge = false;
		// fetch
		try {
			const abortCtl = new AbortController();
			exec.token.onCancellationRequested(_ => abortCtl.abort());

			for (let queryData of allQueryData) {
				const octokit = await this.octokit.lib();

				let page = 1;
				let count = 0;
				while (!exec.token.isCancellationRequested) {

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
			exec.replaceOutput([new vscode.NotebookCellOutput([
				new vscode.NotebookCellOutputItem('application/x.notebook.error-traceback', {
					ename: err instanceof Error && err.name || 'error',
					evalue: err instanceof Error && err.message || JSON.stringify(err, undefined, 4),
					traceback: []
				})
			])]);
			exec.end({ success: false });
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
		exec.replaceOutput([new vscode.NotebookCellOutput([
			new vscode.NotebookCellOutputItem(mimeGithubIssues, allItems),
			new vscode.NotebookCellOutputItem('text/markdown', md),
		])]);

		exec.end({ success: true });
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

		for (const candidate of cell.notebook.getCells()) {
			if (seen.has(candidate.document.uri.toString())) {
				bucket.add(candidate);
			}
		}
	}
}

// --- status bar

export class IssuesStatusBarProvider implements vscode.NotebookCellStatusBarItemProvider {

	provideCellStatusBarItems(cell: vscode.NotebookCell): vscode.NotebookCellStatusBarItem[] | undefined {
		let issues: { html_url: string; }[] | undefined;
		out: for (let output of cell.outputs) {
			for (let item of output.outputs) {
				if (item.mime === mimeGithubIssues) {
					issues = item.value as { html_url: string; }[];
					break out;
				}
			}
		}

		if (!issues) {
			return;
		}

		return [new vscode.NotebookCellStatusBarItem(
			`$(globe) Open ${issues.length} results`,
			vscode.NotebookCellStatusBarAlignment.Right,
			'github-issues.openAll',
			`Open ${issues.length} results in browser`
		)];
	}
}


// --- serializer

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.NotebookCellKind;
	editable?: boolean;
}

export class IssuesNotebookSerializer implements vscode.NotebookSerializer {

	private readonly _decoder = new TextDecoder();
	private readonly _encoder = new TextEncoder();

	deserializeNotebook(data: Uint8Array): vscode.NotebookData {
		let contents = '';
		try {
			contents = this._decoder.decode(data);
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
			item.language
		));

		return new vscode.NotebookData(
			cells,
			new vscode.NotebookDocumentMetadata()
		);
	}

	serializeNotebook(data: vscode.NotebookData): Uint8Array {
		let contents: RawNotebookCell[] = [];
		for (let cell of data.cells) {
			contents.push({
				kind: cell.kind,
				language: cell.language,
				value: cell.source
			});
		}
		return this._encoder.encode(JSON.stringify(contents, undefined, 2));
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
