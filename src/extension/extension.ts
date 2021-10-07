/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerLanguageProvider } from './languageProvider';
import { IssuesNotebookKernel, IssuesNotebookSerializer, IssuesStatusBarProvider } from './notebookProvider';
import { OctokitProvider } from './octokitProvider';
import { ProjectContainer } from './project';

export function activate(context: vscode.ExtensionContext) {
	const octokit = new OctokitProvider();
	const projectContainer = new ProjectContainer();

	context.subscriptions.push(new IssuesNotebookKernel(projectContainer, octokit));
	context.subscriptions.push(vscode.notebooks.registerNotebookCellStatusBarItemProvider('github-issues', new IssuesStatusBarProvider()));
	context.subscriptions.push(vscode.workspace.registerNotebookSerializer('github-issues', new IssuesNotebookSerializer(), {
		transientOutputs: true,
		transientCellMetadata: {
			inputCollapsed: true,
			outputCollapsed: true,
		}
	}));
	context.subscriptions.push(registerLanguageProvider(projectContainer, octokit));
	context.subscriptions.push(registerCommands(projectContainer, octokit));
}
