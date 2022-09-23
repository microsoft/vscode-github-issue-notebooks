/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { mimeGithubIssues } from './notebookProvider';
import { OctokitProvider } from './octokitProvider';
import { ProjectContainer } from './project';

declare class TextDecoder {
	decode(data: Uint8Array): string;
}

export function registerCommands(projectContainer: ProjectContainer, octokit: OctokitProvider): vscode.Disposable {

	const subscriptions: vscode.Disposable[] = [];

	subscriptions.push(vscode.commands.registerCommand('github-issues.new', async () => {
		const newNotebook = await vscode.workspace.openNotebookDocument('github-issues', new vscode.NotebookData(
			[new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'repo:microsoft/vscode is:open', 'github-issues')]
		));
		await vscode.commands.executeCommand('vscode.openWith', newNotebook.uri, 'github-issues');
	}));

	subscriptions.push(vscode.commands.registerCommand('github-issues.openAll', async (cell: vscode.NotebookCell) => {

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
			const ok = vscode.l10n.t('OK');
			const option = await vscode.window.showInformationMessage(
				vscode.l10n.t('This will open {0} browser tabs. Do you want to continue?', items.length),
				{ modal: true },
				ok
			);
			if (option !== ok) {
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

	subscriptions.push(vscode.commands.registerCommand('github-issues.authNow', async () => {
		await octokit.lib(true);
	}));

	return vscode.Disposable.from(...subscriptions);
}
