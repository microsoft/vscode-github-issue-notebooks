/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as assert from 'assert';
import * as vscode from 'vscode';
import { Project } from '../project';

suite('Project', () => {

	test('asQueryData', async function () {

		async function assertQueryData(content: string, expected: { q: string; sort?: string; order?: string; }[] = [{ q: content }]) {
			const doc = await vscode.workspace.openTextDocument({ language: 'github-issues', content });
			const project = new Project();
			project.getOrCreate(doc);
			const data = project.queryData(doc);
			for (let actualItem of data) {
				const expectedItem = expected.shift();
				assert.equal(actualItem.q, expectedItem?.q);
				assert.ok(!expectedItem?.order || expectedItem.order === actualItem.order);
				assert.ok(!expectedItem?.sort || expectedItem.sort === actualItem.sort);
			}
			assert.equal(expected.length, 0, expected.toString());
		}

		await assertQueryData('foo repo:bar');
		await assertQueryData('foo repo:bar sort:comments-asc', [{ q: 'foo repo:bar', order: 'asc', sort: 'comments' }]);
		await assertQueryData('$bar=bazz\n$bar repo:bar', [{ q: 'bazz repo:bar' }]);
		await assertQueryData('$bar=bazz', []);
		await assertQueryData('foo OR bar', [{ q: 'foo' }, { q: 'bar' }]);
		// await assertQueryData('$a=foo repo:bar sort asc by comments\n$a', [{ q: 'foo repo:bar', order: 'asc', sort: 'comments' }]);

		await assertQueryData('repo:microsoft/vscode label:notebook is:open -milestone:"April 2020" -milestone:"Backlog"');
	});

});
