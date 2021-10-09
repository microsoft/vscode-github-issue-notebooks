/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { mimeGithubIssues, ResultData } from './notebookProvider';
import { OctokitProvider } from './octokitProvider';
import { ProjectContainer } from './project';

declare class TextDecoder {
	decode(data: Uint8Array): string;
}

function buildResultNumbersForRepo(repo: string, items: ResultData[]): number[] {
	let nums: number[] = [];
	for (let item of items) {
		if (item.html_url.startsWith(repo)) {
			nums.push(item.number);
		}
	}

	return nums;
}

export function registerCommands(projectContainer: ProjectContainer, octokit: OctokitProvider): vscode.Disposable {

	const subscriptions: vscode.Disposable[] = [];

	subscriptions.push(vscode.commands.registerCommand('github-issues.new', async () => {
		const newNotebook = await vscode.workspace.openNotebookDocument('github-issues', new vscode.NotebookData(
			[new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'repo:microsoft/vscode is:open', 'github-issues')]
		));
		await vscode.window.showNotebookDocument(newNotebook);
	}));

	subscriptions.push(vscode.commands.registerCommand('github-issues.openEach', async (cell: vscode.NotebookCell) => {

		let items: { html_url: string; }[] | undefined;
		out: for (let output of cell.outputs) {
			for (let item of output.items) {
				if (item.mime === mimeGithubIssues) {
					items = JSON.parse(new TextDecoder().decode(item.data));
					break out;
				}
			}
		}
		if (!items) {
			return;
		}

		if (items.length > 10) {
			const option = await vscode.window.showInformationMessage(
				`This will open ${items.length} browser tabs. Do you want to continue?`,
				{ modal: true },
				'OK'
			);
			if (option !== 'OK') {
				return;
			}
		}
		for (let item of items) {
			await vscode.env.openExternal(vscode.Uri.parse(item.html_url));
		}
	}));

	subscriptions.push(vscode.commands.registerCommand('github-issues.copyQueryToClipboard', async (cell: vscode.NotebookCell) => {
		const project = projectContainer.lookupProject(cell.document.uri, false);
		if (!project) {
			return;
		}
		const data = project.queryData(project.getOrCreate(cell.document));
		let query: string = '';
		for (let d of data) {
			query += d.q + '\n';
		}

		await vscode.env.clipboard.writeText(query);
		vscode.window.showInformationMessage('Expanded cell query copied to clipboard.');
	}));

	subscriptions.push(vscode.commands.registerCommand('github-issues.openResultsByNumbers', async (cell: vscode.NotebookCell) => {

		let items: ResultData[] | undefined;
		out: for (let output of cell.outputs) {
			for (let item of output.items) {
				if (item.mime === mimeGithubIssues) {
					items = JSON.parse(new TextDecoder().decode(item.data));
					break out;
				}
			}
		}
		if (!items) {
			return;
		}

		// Get the unique set of repos from the list.
		let repos = [...new Set(Array.from(items, x => x.html_url.replace(/(\/[\d]+$)/g, '')))];

		// For each repo build the list of result numbers that belong to it.
		for (let r of repos) {
			let results = buildResultNumbersForRepo(r, items);

			// There is some hard limit to the number of results that can be opened by number. 
			// Seems like it always accepts at least 50, so limiting it to that.
			if (results.length > 50) {
				await vscode.window.showInformationMessage(
					`More than 50 results in ${r}. Not opened.`,
				);
			} else if (results.length > 0) {
				let results_string: string = '';
				results.forEach(n => {
					results_string += `${n} `;
				});

				let url = `${r}?q=${results_string}`;
				await vscode.env.openExternal(vscode.Uri.parse(url));
			}
		}
	}));

	subscriptions.push(vscode.commands.registerCommand('github-issues.openQuery', async (cell: vscode.NotebookCell) => {
		const project = projectContainer.lookupProject(cell.document.uri, false);
		if (!project) {
			return;
		}
		const data = project.queryData(project.getOrCreate(cell.document));
		for (let d of data) {
			let repos = d.q.match(/repo:\S+/g);	// Find all the 'repo:xxx' specifications.
			let params = d.q.replace(/repo:\S+\s+/g, '');	// Get the parameters without the repos.

			// Open each repo's URL to the issue query so that batch changes can be made.
			if (repos !== null) {
				for (let r of repos) {
					let url = `https://github.com/${r.replace(/repo:/, '')}/issues?q=${params}`;
					if (d.sort) {
						url += ` sort:${d.sort}`;
					}
					if (d.order) {
						url += `-${d.order}`;
					}
					await vscode.env.openExternal(vscode.Uri.parse(url));
				}
			}
		}
	}));

	subscriptions.push(vscode.commands.registerCommand('github-issues.authNow', async () => {
		await octokit.lib(true);
	}));

	return vscode.Disposable.from(...subscriptions);
}
