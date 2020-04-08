/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import { NodeType, QueryNode, Utils } from '../parser/nodes';
import { Parser } from '../parser/parser';
import * as assert from 'assert';
import { validateQueryDocument, Code } from '../parser/validation';
import { SymbolTable } from '../parser/symbols';

suite('Validation', function () {

	function assertValidateErrors(input: string, ...expected: Code[]) {
		const symbols = new SymbolTable();
		const parser = new Parser();
		const query = parser.parse(input, 'file1');
		symbols.update(query);
		const errors = validateQueryDocument(query, symbols);
		for (let { code } of errors) {
			assert.deepEqual(code, expected.shift());
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
		assertValidateErrors('comments:true', Code.ValueUnknown);
		assertValidateErrors('comments:$var', Code.ValueUnknown);
		assertValidateErrors('$var=true\ncomments:$var', Code.ValueUnknown);
		assertValidateErrors('comments:>true', Code.NodeMissing);
		assertValidateErrors('comments:>=true', Code.NodeMissing);
		assertValidateErrors('$var=true\ncomments:>$var', Code.ValueUnknown);
		assertValidateErrors('$var=true\ncomments:>=$var', Code.ValueUnknown);
		assertValidateErrors('$var=true\ncomments:<$var', Code.ValueUnknown);
		assertValidateErrors('$var=true\ncomments:<=$var', Code.ValueUnknown);
		assertValidateErrors('$var=true\ncomments:$var..*', Code.ValueUnknown);
		assertValidateErrors('$var=true\ncomments:$var..$var', Code.ValueUnknown);
		assertValidateErrors('$var=true\ncomments:*..$var', Code.ValueUnknown);
		assertValidateErrors('$var=123\ncomments:$var');
		assertValidateErrors('comments:123');
		assertValidateErrors('comments:123..123');
		assertValidateErrors('comments:123..*');
		assertValidateErrors('comments:*..123');
		assertValidateErrors('$var=42\ncomments:$var..123');
		assertValidateErrors('$var=123\ncomments:$var..2020-03-22', Code.RangeMixesTypes);
		assertValidateErrors('is:issue is:pr is:open', Code.ValueConflict);
	});

	test('variable definition', function () {
		assertValidateErrors('$var=foo or bar');
		assertValidateErrors('$var=foo OR bar', Code.OrNotAllowed);
		assertValidateErrors('$var=', Code.NodeMissing);
		assertValidateErrors('$var=foo $var', Code.VariableDefinedRecursive);
		assertValidateErrors('$var=$foo', Code.VariableUnknown);
		assertValidateErrors('$var=foo sort desc by comments', Code.SortByNotAllowed);
	});

	test('repeated milestone etc', function () {
		// https://github.com/microsoft/vscode-github-issue-notebooks/issues/4

		assertValidateErrors('repo:microsoft/vscode label:notebook is:open milestone:"April 2020" milestone:"Backlog"', Code.ValueConflict);
		assertValidateErrors('repo:microsoft/vscode label:notebook is:open -milestone:"April 2020" -milestone:"Backlog"', Code.ValueConflict);
		assertValidateErrors('repo:foo OR no:assignee no:label');
	});
});
