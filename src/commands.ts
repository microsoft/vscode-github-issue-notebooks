/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function registerCommands(context: vscode.ExtensionContext) {
	// commands
	context.subscriptions.push(vscode.commands.registerCommand('github-issues.clearAllCellsOutput', () => {
		if (vscode.notebook.activeNotebookDocument) {
			vscode.notebook.activeNotebookDocument.cells.forEach(cell => cell.outputs = []);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.clearCellOutput', (cell: vscode.NotebookCell) => {
		cell.outputs = [];
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.lockCell', (cell: vscode.NotebookCell) => {
		cell.metadata = { editable: false, runnable: true };
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.unlockCell', (cell: vscode.NotebookCell) => {
		cell.metadata = { editable: true, runnable: true };
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.unlockDocument', () => {
		if (vscode.notebook.activeNotebookDocument) {
			vscode.notebook.activeNotebookDocument.metadata = { editable: true, cellEditable: true, cellRunnable: true };
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('github-issues.lockDocument', () => {
		if (vscode.notebook.activeNotebookDocument) {
			vscode.notebook.activeNotebookDocument.metadata = { editable: false, cellEditable: false, cellRunnable: true };
		}
	}));
}