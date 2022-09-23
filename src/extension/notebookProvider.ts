/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import AbortController from "abort-controller";
import * as vscode from 'vscode';
import { SearchIssuesAndPullRequestsResponseItemsItem } from '../common/types';
import { OctokitProvider } from "./octokitProvider";
import { NodeType, Utils } from "./parser/nodes";
import { ProjectContainer } from './project';
import { isRunnable, isUsingAtMe } from './utils';


export const mimeGithubIssues = 'x-application/github-issues';

const atMeLink = '[`@me`](https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax#queries-with-usernames)';

// --- running queries

export class IssuesNotebookKernel {

	private readonly _controller: vscode.NotebookController;
	private _executionOrder = 0;

	constructor(
		readonly container: ProjectContainer,
		readonly octokit: OctokitProvider
	) {

		this._controller = vscode.notebooks.createNotebookController(
			'githubIssueKernel',
			'github-issues',
			'github.com',
		);
		this._controller.supportedLanguages = ['github-issues'];
		this._controller.supportsExecutionOrder = true;
		this._controller.description = 'GitHub';
		this._controller.executeHandler = this._executeAll.bind(this);
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

		const exec = this._controller.createNotebookCellExecution(cell);
		exec.executionOrder = ++this._executionOrder;
		exec.start(Date.now());


		if (!isRunnable(query)) {
			exec.end(true);
			return;
		}

		if (!this.octokit.isAuthenticated) {
			const atMe = isUsingAtMe(query, project);
			if (atMe > 0) {
				const message = atMe > 1
					? vscode.l10n.t({
						message: 'This query depends on {0} to specify the current user. For that to work you need to be [logged in](command:github-issues.authNow).',
						args: [atMeLink],
						comment: [
							'The [...](command:...) will be rendered as a markdown link. Only the contents of the square brackets should be translated',
							'{Locked="](command:github-issues.authNow)"}'
						]
					})
					: vscode.l10n.t({
						message: 'This query uses {0} to specify the current user. For that to work you need to be [logged in](command:github-issues.authNow).',
						args: [atMeLink],
						comment: [
							'The [...](command:...) will be rendered as a markdown link. Only the contents of the square brackets should be translated',
							'{Locked="](command:github-issues.authNow)"}'
						]
					});
				exec.replaceOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(message, 'text/markdown')]));
				exec.end(false);
				return;
			}
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
			if (err instanceof Error && err.message.includes('Authenticated requests get a higher rate limit')) {
				// ugly error-message checking for anon-rate-limit. where are the error codes?
				const message = vscode.l10n.t({
					message: 'You have exceeded the rate limit for anonymous querying. You can [log in](command:github-issues.authNow) to continue querying.',
					comment: [
						'The [...](command:...) will be rendered as a markdown link. Only the contents of the square brackets should be translated',
						'{Locked="](command:github-issues.authNow)"}'
					]
				});
				exec.replaceOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(message, 'text/markdown')]));
			} else if (err instanceof Error && err.message.includes('The listed users cannot be searched')) {
				const message = vscode.l10n.t({
					message: 'This query uses {0} to specify the current user. For that to work you need to be [logged in](command:github-issues.authNow).',
					args: [atMeLink],
					comment: [
						'The [...](command:...) will be rendered as a markdown link. Only the contents of the square brackets should be translated',
						'{Locked="](command:github-issues.authNow)"}'
					]
				});
				exec.replaceOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(message, 'text/markdown')]));
			} else {
				// print as error
				exec.replaceOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(err)]));
			}
			exec.end(false);
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
			md += `- [#${item.number}](${item.html_url}) ${item.title}`;
			if (item.labels.length > 0) {
				md += ` [${item.labels.map(label => `${label.name}`).join(', ')}] `;
			}
			if (item.assignee) {
				md += `- [@${item.assignee.login}](${item.assignee.html_url} "${vscode.l10n.t('Issue {0} is assigned to {1}', item.number, item.assignee.login)}")\n`;
			}
			md += '\n';
		}

		// status line
		exec.replaceOutput([new vscode.NotebookCellOutput([
			vscode.NotebookCellOutputItem.json(allItems, mimeGithubIssues),
			vscode.NotebookCellOutputItem.text(md, 'text/markdown'),
		], { itemCount: allItems.length })]);

		exec.end(true, Date.now());
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

	provideCellStatusBarItems(cell: vscode.NotebookCell): vscode.NotebookCellStatusBarItem | undefined {
		const count = <number | undefined>cell.outputs[0]?.metadata?.['itemCount'];
		if (typeof count !== 'number') {
			return;
		}
		const item = new vscode.NotebookCellStatusBarItem(
			'$(globe) ' + vscode.l10n.t('Open {0} results', count),
			vscode.NotebookCellStatusBarAlignment.Right,
		);
		item.command = 'github-issues.openAll';
		item.tooltip = vscode.l10n.t('Open {0} results in browser', count);
		return item;
	}
}


// --- serializer

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.NotebookCellKind;
	editable?: boolean;
}

declare class TextDecoder {
	decode(data: Uint8Array): string;
}

declare class TextEncoder {
	encode(data: string): Uint8Array;
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

		return new vscode.NotebookData(cells);
	}

	serializeNotebook(data: vscode.NotebookData): Uint8Array {
		let contents: RawNotebookCell[] = [];
		for (let cell of data.cells) {
			contents.push({
				kind: cell.kind,
				language: cell.languageId,
				value: cell.value
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
