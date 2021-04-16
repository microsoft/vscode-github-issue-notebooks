/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { mimeGithubIssues } from './notebookProvider';
import { ProjectContainer } from './project';

export function registerCommands(projectContainer: ProjectContainer): vscode.Disposable {

	const subscriptions: vscode.Disposable[] = [];


	subscriptions.push(vscode.commands.registerCommand('github-issues.openAll', async (cell: vscode.NotebookCell) => {

		let items: { html_url: string; }[] | undefined;
		out: for (let output of cell.outputs) {
			for (let item of output.outputs) {
				if (item.mime === mimeGithubIssues) {
					items = item.value as { html_url: string; }[];
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

	subscriptions.push(vscode.commands.registerCommand('github-issues.openUrl', async (cell: vscode.NotebookCell) => {
		const project = projectContainer.lookupProject(cell.document.uri, false);
		if (!project) {
			return;
		}
		const data = project.queryData(project.getOrCreate(cell.document));
		for (let d of data) {
			let url = `https://github.com/issues?q=${d.q}`;
			if (d.sort) {
				url += ` sort:${d.sort}`;
			}
			if (d.order) {
				url += `-${d.order}`;
			}
			await vscode.env.openExternal(vscode.Uri.parse(url));
		}
	}));

	return vscode.Disposable.from(...subscriptions);
}
