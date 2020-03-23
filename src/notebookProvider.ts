/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Project, ProjectContainer } from './project';
import { Octokit } from '@octokit/rest';

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.CellKind;
	outputs: vscode.CellOutput[];
}

export class IssuesNotebookProvider implements vscode.NotebookProvider {

	private _octokit = new Octokit();

	constructor(
		readonly container: ProjectContainer,
	) { }

	private async _withOctokit() {
		try {
			let [first] = await vscode.authentication.getSessions('github', []);
			if (!first) {
				first = await vscode.authentication.login('github', []);
			}
			const token = await first.getAccessToken();
			this._octokit = new Octokit({ auth: token });

		} catch (err) {
			// no token
			console.warn('FAILED TO AUTHENTICATE');
			console.warn(err);
		}
		return this._octokit;
	}

	async resolveNotebook(editor: vscode.NotebookEditor): Promise<void> {

		// todo@API unregister?
		this.container.register(
			editor.document.uri,
			{ has: (uri) => editor.document.cells.find(cell => cell.uri.toString() === uri.toString()) !== undefined },
			new Project()
		);

		editor.document.languages = ['github-issues'];

		const contents = Buffer.from(await vscode.workspace.fs.readFile(editor.document.uri)).toString('utf8');
		let raw: RawNotebookCell[];
		try {
			raw = <RawNotebookCell[]>JSON.parse(contents);
		} catch {
			//?
			raw = [{ kind: vscode.CellKind.Code, language: 'github-issues', value: '', outputs: [] }];
		}
		editor.document.cells = raw.map(cell => editor.createCell(cell.value, cell.language, cell.kind, cell.outputs ?? [], { editable: true }));
	}

	async executeCell(_document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined): Promise<void> {
		if (!cell) {
			return;
		}
		const doc = await vscode.workspace.openTextDocument(cell.uri);
		const project = this.container.lookupProject(doc.uri);
		const allQueryData = project.queryData(doc);

		// update all symbols defined in the cell so that
		// more recent values win
		const query = project.getOrCreate(doc);
		project.symbols.update(query, doc.uri);

		try {

			// fetch
			let allItems: SearchIssuesAndPullRequestsResponseItemsItem[] = [];
			for (let queryData of allQueryData) {
				const octokit = await this._withOctokit();
				const options = octokit.search.issuesAndPullRequests.endpoint.merge({
					q: queryData.q,
					sort: queryData.sort,
					order: queryData.order,
					per_page: 100,
				});
				const items = await octokit.paginate<SearchIssuesAndPullRequestsResponseItemsItem>(<any>options);
				allItems = allItems.concat(items);
			}

			// sort
			const [first] = allQueryData;
			const comparator = allQueryData.length >= 2 && allQueryData.every(item => item.sort === first.sort) && cmp.byName.get(first.sort!);
			if (comparator) {
				allItems.sort(first.sort === 'asc' ? cmp.invert(comparator) : comparator);
			}

			// "render"
			const seen = new Set<number>();
			let md = '';
			for (let item of allItems) {
				if (seen.has(item.id)) {
					continue;
				}
				// markdown
				md += `- [#${item.number}](${item.html_url}) ${item.title} [${item.labels.map(label => `${label.name}`).join(', ')}]`;
				if (item.assignee) {
					md += `- [@${item.assignee.login}](${item.assignee.html_url})\n`;
				}
				md += '\n';
				seen.add(item.id);
			}

			cell.outputs = [{
				outputKind: vscode.CellOutputKind.Rich,
				data: {
					['text/markdown']: md,
					['text/plain']: allQueryData.map(d => `${d.q}, ${d.sort || 'default'} sort`).join('\n\n')
				}
			}];

		} catch (err) {
			console.error(err);
			cell.outputs = [{
				outputKind: vscode.CellOutputKind.Text,
				text: JSON.stringify(err)
			}];
		}
	}

	async save(document: vscode.NotebookDocument): Promise<boolean> {
		let contents: RawNotebookCell[] = [];
		for (let cell of document.cells) {
			contents.push({
				kind: cell.cellKind,
				language: cell.language,
				value: cell.getContent(),
				outputs: cell.outputs
			});
		}
		await vscode.workspace.fs.writeFile(document.uri, Buffer.from(JSON.stringify(contents)));
		return true;
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

//#region COPY of type definitions that are well hidden inside @octokit/types
declare type SearchIssuesAndPullRequestsResponseItemsItemUser = {
	avatar_url: string;
	events_url: string;
	followers_url: string;
	following_url: string;
	gists_url: string;
	gravatar_id: string;
	html_url: string;
	id: number;
	login: string;
	node_id: string;
	organizations_url: string;
	received_events_url: string;
	repos_url: string;
	starred_url: string;
	subscriptions_url: string;
	type: string;
	url: string;
};
declare type SearchIssuesAndPullRequestsResponseItemsItemPullRequest = {
	diff_url: null;
	html_url: null;
	patch_url: null;
};
declare type SearchIssuesAndPullRequestsResponseItemsItemLabelsItem = {
	color: string;
	id: number;
	name: string;
	node_id: string;
	url: string;
};
declare type SearchIssuesAndPullRequestsResponseItemsItem = {
	assignee: null | SearchIssuesAndPullRequestsResponseItemsItemUser;
	assignees: null | Array<SearchIssuesAndPullRequestsResponseItemsItemUser>;
	body: string;
	closed_at: null;
	comments: number;
	comments_url: string;
	created_at: string;
	events_url: string;
	html_url: string;
	id: number;
	labels: Array<SearchIssuesAndPullRequestsResponseItemsItemLabelsItem>;
	labels_url: string;
	milestone: null;
	node_id: string;
	number: number;
	pull_request: SearchIssuesAndPullRequestsResponseItemsItemPullRequest;
	repository_url: string;
	score: number;
	state: string;
	title: string;
	updated_at: string;
	url: string;
	user: SearchIssuesAndPullRequestsResponseItemsItemUser;
};
//#endregion
