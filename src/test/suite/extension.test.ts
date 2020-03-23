/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as assert from 'assert';
import * as vscode from 'vscode';
import { Project } from '../../project';

suite('Project', () => {

	test('asQueryData', () => {

		async function assertQueryData(content: string, expected: string[] = [content]) {
			const doc = await vscode.workspace.openTextDocument({ language: 'github-issues', content });
			const project = new Project();
			project.getOrCreate(doc);

			const data = project.queryData(doc);
			for (let item of data) {
				assert.equal(item.q, expected.shift());
			}
			assert.equal(expected.length, 0, expected.toString());
		}

		assertQueryData('foo repo:bar');
		assertQueryData('$bar=bazz\n$bar repo:bar', ['bazz repo:bar']);
		assertQueryData('$bar=bazz', []);
		assertQueryData('foo OR bar', ['foo', 'bar']);

	});
});
