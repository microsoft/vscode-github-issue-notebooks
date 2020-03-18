/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProjectContainer } from './project';
import { IssuesNotebookProvider } from './notebookProvider';
import { registerLanguageProvider } from './languageProvider';

export function activate(context: vscode.ExtensionContext) {
	const projectContainer = new ProjectContainer();
	context.subscriptions.push(vscode.window.registerNotebookProvider('github-issues', new IssuesNotebookProvider(projectContainer)));
	context.subscriptions.push(registerLanguageProvider(projectContainer));
}

