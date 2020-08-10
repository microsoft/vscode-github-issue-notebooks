/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Completions', () => {

	suiteSetup(async function () {
		await vscode.extensions.getExtension('ms-vscode.vscode-github-issue-notebooks')?.activate();
	});

	test('QualifiedValue', async function () {

		async function assertCompletions(input: string, ...expected: string[]) {

			const offset = input.indexOf('|');
			const content = input.substring(0, offset) + input.substring(offset + 1);

			const doc = await vscode.workspace.openTextDocument({ language: 'github-issues', content });
			const pos = doc.positionAt(offset);

			const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, pos);

			const actual = result!.items.map(item => item.label);
			assert.deepEqual(actual, expected, input);
		}

		await assertCompletions('type:i|', 'issue', 'pr');
		await assertCompletions('type:|', 'issue', 'pr');
	});

});
