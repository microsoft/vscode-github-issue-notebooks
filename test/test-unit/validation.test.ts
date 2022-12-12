/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'mocha';
import { Parser } from '../../src/extension/parser/parser';
import { SymbolTable } from '../../src/extension/parser/symbols';
import { Code, validateQueryDocument } from '../../src/extension/parser/validation';

suite('Validation', function () {

	function assertValidateErrors(input: string, ...expected: Code[]) {
		const symbols = new SymbolTable();
		const parser = new Parser();
		const query = parser.parse(input, 'file1');
		symbols.update(query);
		const errors = validateQueryDocument(query, symbols);
		for (let { code } of errors) {
			assert.deepEqual(code, expected.shift(), input);
		}
		assert.equal(expected.length, 0);
	}

	test('node missing', function () {
		assertValidateErrors('label:', Code.NodeMissing);
		assertValidateErrors('label:>', Code.NodeMissing);
		assertValidateErrors('label:>=', Code.NodeMissing);
		assertValidateErrors('label:<', Code.NodeMissing);
		assertValidateErrors('label:<=', Code.NodeMissing);
		assertValidateErrors('$foo=', Code.NodeMissing);
		assertValidateErrors('$foo= ', Code.NodeMissing);
	});

	test('qualified value', function () {
		assertValidateErrors('milestone:"March 2020"');
		assertValidateErrors('Label:foo', Code.QualifierUnknown);
		assertValidateErrors('bar:foo', Code.QualifierUnknown);
		assertValidateErrors('comments:true', Code.ValueTypeUnknown);
		assertValidateErrors('comments:$var', Code.ValueTypeUnknown);
		assertValidateErrors('$var=true\ncomments:$var', Code.ValueTypeUnknown);
		assertValidateErrors('comments:>true', Code.NodeMissing);
		assertValidateErrors('comments:>=true', Code.NodeMissing);
		assertValidateErrors('$var=true\ncomments:>$var', Code.ValueTypeUnknown);
		assertValidateErrors('$var=true\ncomments:>=$var', Code.ValueTypeUnknown);
		assertValidateErrors('$var=true\ncomments:<$var', Code.ValueTypeUnknown);
		assertValidateErrors('$var=true\ncomments:<=$var', Code.ValueTypeUnknown);
		assertValidateErrors('$var=true\ncomments:$var..*', Code.ValueTypeUnknown);
		assertValidateErrors('$var=true\ncomments:$var..$var', Code.ValueTypeUnknown);
		assertValidateErrors('$var=true\ncomments:*..$var', Code.ValueTypeUnknown);
		assertValidateErrors('$var=123\ncomments:$var');
		assertValidateErrors('comments:123');
		assertValidateErrors('comments:123..123');
		assertValidateErrors('comments:123..*');
		assertValidateErrors('comments:*..123');
		assertValidateErrors('$var=42\ncomments:$var..123');
		assertValidateErrors('$var=123\ncomments:$var..2020-03-22', Code.RangeMixesTypes);
		assertValidateErrors('is:issue is:pr is:open', Code.ValueConflict);
		assertValidateErrors('foo:');
		assertValidateErrors('label:', Code.NodeMissing);
		assertValidateErrors('-label:', Code.NodeMissing);
		assertValidateErrors('label:foo,bar');
		assertValidateErrors('milestone:foo,bar', Code.SequenceNotAllowed);
		assertValidateErrors('reason:completed');
		assertValidateErrors('reason:"not planned"');
		assertValidateErrors('reason:"not supported"', Code.ValueUnknown);
	});

	test('variable definition', function () {
		assertValidateErrors('$var=foo or bar');
		assertValidateErrors('$var=foo OR bar', Code.OrNotAllowed);
		assertValidateErrors('$var=', Code.NodeMissing);
		assertValidateErrors('$var=foo $var', Code.VariableDefinedRecursive);
		assertValidateErrors('$var=$foo', Code.VariableUnknown);
		assertValidateErrors('$var=foo sort:comments-desc');
	});

	test('repeated milestone etc', function () {
		// https://github.com/microsoft/vscode-github-issue-notebooks/issues/4
		// https://github.com/microsoft/vscode-github-issue-notebooks/issues/16

		// assignee: repeat_negated
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open assignee:jrieken assignee:octref', Code.ValueConflict);
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open assignee:jrieken assignee:fff -assignee:octref', Code.ValueConflict);
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open -assignee:jrieken -assignee:octref');
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open -assignee:jrieken -assignee:octref assignee:bar');

		// author: repeat_negated
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open -author:jrieken author:octref author:bar', Code.ValueConflict);
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open -author:jrieken -author:octref author:bar');

		// repeat: repeat_no
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open milestone:"April 2020" milestone:"Backlog"', Code.ValueConflict);
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open -milestone:"April 2020" -milestone:"Backlog"', Code.ValueConflict);

		// repeat
		assertValidateErrors('repo:foo OR no:assignee no:label');
		assertValidateErrors('repo:foo OR is:open is:issue');
	});

	test('Show Error/Warning when the query is invalid #24', function () {
		// https://github.com/microsoft/vscode-github-issue-notebooks/issues/24
		assertValidateErrors('fooBar -assignee:@me sort:created-asc');
		assertValidateErrors('fooBar sort:created-asc -assignee:@me');
	});

	test('Can\'t assign `sort:reactions-+1-desc` to a variable #54', function () {
		assertValidateErrors('$upvote_sort=sort:reactions-+1-desc');
	});
});
