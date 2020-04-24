/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function registerCommands(context: vscode.ExtensionContext) {
	// commands
	context.subscriptions.push(vscode.commands.registerCommand('github-issues.lockCell', (cell: vscode.NotebookCell) => {
		cell.metadata = { ...cell.metadata, editable: false };
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.unlockCell', (cell: vscode.NotebookCell) => {
		cell.metadata = { ...cell.metadata, editable: true };
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.unlockDocument', () => {
		if (vscode.notebook.activeNotebookEditor) {
			const { document } = vscode.notebook.activeNotebookEditor;
			document.metadata = { ...document.metadata, editable: true, cellEditable: true };
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.lockDocument', () => {
		if (vscode.notebook.activeNotebookEditor) {
			const { document } = vscode.notebook.activeNotebookEditor;
			document.metadata = { ...document.metadata, editable: false, cellEditable: false };
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.openAll', async (cell: vscode.NotebookCell) => {

		const output = <vscode.CellDisplayOutput>cell.outputs.filter(output => output.outputKind === vscode.CellOutputKind.Rich)[0];
		if (!output) {
			return;
		}
		const items = <{ html_url: string; }[]>output.data['x-application/github-issues'];
		if (!items) {
			return;
		}
		if (items.length > 10) {
			const option = await vscode.window.showInformationMessage(
				`This will open ${items.length} browser tabs. Do you want to continue?`,
				{ modal: true },
				'OK'
			);
			if (option !== 'Continue') {
				return;
			}
		}
		for (let item of items) {
			await vscode.env.openExternal(vscode.Uri.parse(item.html_url));
		}
	}));
}
