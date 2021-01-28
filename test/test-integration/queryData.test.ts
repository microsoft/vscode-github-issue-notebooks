/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { Project } from '../../src/extension/project';

suite('Project', () => {

	async function assertQueryData(content: string, expected: { q: string; sort?: string; order?: string; }[] = [{ q: content }]) {
		const doc = await vscode.workspace.openTextDocument({ language: 'github-issues', content });
		const project = new Project();
		const query = project.getOrCreate(doc);
		const data = project.queryData(query);
		for (let actualItem of data) {
			const expectedItem = expected.shift();
			assert.equal(actualItem.q, expectedItem?.q, 'q');
			assert.equal(actualItem.order, expectedItem?.order, 'order');
			assert.equal(actualItem.sort, expectedItem?.sort, 'sort');
		}
		assert.equal(expected.length, 0, expected.toString());
	}

	test('asQueryData', async function () {

		await assertQueryData('foo repo:bar');
		await assertQueryData('foo repo:bar sort:comments-asc', [{ q: 'foo repo:bar', order: 'asc', sort: 'comments' }]);
		await assertQueryData('$bar=bazz\n$bar repo:bar', [{ q: 'bazz repo:bar' }]);
		await assertQueryData('$bar=bazz', []);
		await assertQueryData('foo OR bar', [{ q: 'foo' }, { q: 'bar' }]);
		// await assertQueryData('$a=foo repo:bar sort asc by comments\n$a', [{ q: 'foo repo:bar', order: 'asc', sort: 'comments' }]);

		await assertQueryData('repo:microsoft/vscode label:notebook is:open -milestone:"April 2020" -milestone:"Backlog"');
	});

	test('"sort" affects the number of results returned #68', async function () {
		await assertQueryData('repo:microsoft/vscode-js-debug bug sort:updated-asc', [{
			q: 'repo:microsoft/vscode-js-debug bug',
			sort: 'updated',
			order: 'asc'
		}]);
	});

	test('sort via variable', async function () {
		await assertQueryData('$o=sort:updated-asc\nrepo:microsoft/vscode-js-debug bug $o', [{
			q: 'repo:microsoft/vscode-js-debug bug',
			sort: 'updated',
			order: 'asc'
		}]);
	});
});
