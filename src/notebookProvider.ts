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
		editor.document.cells = raw.map(cell => editor.createCell(cell.value, cell.language, cell.kind, cell.outputs ?? []));
	}

	async executeCell(_document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined): Promise<void> {
		if (!cell) {
			return;
		}
		const doc = await vscode.workspace.openTextDocument(cell.uri);
		const project = this.container.lookupProject(doc.uri);
		const query = project.getOrCreate(doc);

		const allQueryData = project.queryData(query, doc.uri);

		try {

			const seen = new Set<number>();
			let md = '';

			for (let queryData of allQueryData) {
				const octokit = await this._withOctokit();
				const options = octokit.search.issuesAndPullRequests.endpoint.merge({
					q: queryData.q, sort: queryData.sort, order: queryData.order,
					per_page: 100,
				});

				const items = await octokit.paginate<SearchIssuesAndPullRequestsResponseItemsItem>(<any>options);
				for (let item of items) {
					if (seen.has(item.id)) {
						continue;
					}
					// markdown
					if (item.assignee) {
						md += `- [#${item.number}](${item.html_url}) ${item.title} - [@${item.assignee.login}](${item.assignee.html_url})\n`;
					} else {
						md += `- [#${item.number}](${item.html_url}) ${item.title}\n`;

					}
					seen.add(item.id);
				}
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
