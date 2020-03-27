/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProjectContainer } from './project';
import { IssuesNotebookProvider } from './notebookProvider';
import { registerLanguageProvider } from './languageProvider';
import { registerCommands } from './commands';
import { OctokitProvider } from './octokitProvider';

export function activate(context: vscode.ExtensionContext) {
	const octokit = new OctokitProvider();
	const projectContainer = new ProjectContainer();
	context.subscriptions.push(vscode.notebook.registerNotebookProvider('github-issues', new IssuesNotebookProvider(projectContainer, octokit)));
	context.subscriptions.push(registerLanguageProvider(projectContainer));
	registerCommands(context);
}

