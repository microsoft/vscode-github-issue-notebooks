/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { suite, test } from 'mocha';
import { Scanner, TokenType } from "../../src/extension/parser/scanner";

suite('Scanner', function () {

	function assertTokenTypes(str: string, ...expected: TokenType[]) {
		const scanner = new Scanner().reset(str);
		const tokens = [...scanner];
		expected.push(TokenType.EOF);
		assert.equal(tokens.length, expected.length, 'len: ' + str);
		tokens.forEach((token, i) => {
			assert.equal(token.type, expected[i], scanner.value(token));
		});
	}

	test('Single', function () {
		assertTokenTypes(' ', TokenType.Whitespace);
		assertTokenTypes('\t', TokenType.Whitespace);
		assertTokenTypes('\t ', TokenType.Whitespace);
		assertTokenTypes('2020-03-11T12:30:00Z', TokenType.DateTime);
		assertTokenTypes('2020-03-11T12:30:00+12:88', TokenType.DateTime);
		assertTokenTypes('2020-03-11', TokenType.Date);
		assertTokenTypes('2', TokenType.Number);
		assertTokenTypes('2dd', TokenType.Literal);
		assertTokenTypes('dd2', TokenType.Literal);
		assertTokenTypes('dd', TokenType.Literal);
		assertTokenTypes('"abc"', TokenType.QuotedLiteral);
		assertTokenTypes('"a b-c 123"', TokenType.QuotedLiteral);
		assertTokenTypes(':', TokenType.Colon);
		assertTokenTypes('<', TokenType.LessThan);
		assertTokenTypes('<=', TokenType.LessThanEqual);
		assertTokenTypes('>', TokenType.GreaterThan);
		assertTokenTypes('>=', TokenType.GreaterThanEqual);
		assertTokenTypes('NOT', TokenType.Not);
		assertTokenTypes('e1109ab', TokenType.SHA);
		assertTokenTypes('e1109AB', TokenType.SHA);
		assertTokenTypes('0eff326d6213c', TokenType.SHA);
		assertTokenTypes('..*', TokenType.RangeFixedStart);
		assertTokenTypes('*..', TokenType.RangeFixedEnd);
		assertTokenTypes('..', TokenType.Range);
		assertTokenTypes('-', TokenType.Dash);
		assertTokenTypes('Foo', TokenType.Literal);
		assertTokenTypes('$Foo', TokenType.VariableName);
		assertTokenTypes('$F', TokenType.VariableName);
		assertTokenTypes('=', TokenType.Equals);
		assertTokenTypes('OR', TokenType.OR);
		assertTokenTypes('\n', TokenType.NewLine);
		assertTokenTypes('\r\n', TokenType.NewLine);
		assertTokenTypes('// aaaaaaa', TokenType.LineComment);
		assertTokenTypes('//', TokenType.LineComment);
		assertTokenTypes('// aaaa aaa', TokenType.LineComment);
		assertTokenTypes(',', TokenType.Comma);
	});

	test('Sequence', function () {

		assertTokenTypes('dd"', TokenType.Literal, TokenType.Unknown);

		assertTokenTypes(
			'repo:desktop/desktop is:open -linked:issue',
			TokenType.Literal, TokenType.Colon, TokenType.Literal, TokenType.Whitespace,
			TokenType.Literal, TokenType.Colon, TokenType.Literal, TokenType.Whitespace,
			TokenType.Dash, TokenType.Literal, TokenType.Colon, TokenType.Literal,
		);

		assertTokenTypes('label:foo', TokenType.Literal, TokenType.Colon, TokenType.Literal);
		assertTokenTypes('label:"foo bar"', TokenType.Literal, TokenType.Colon, TokenType.QuotedLiteral);
		assertTokenTypes('-label:foo', TokenType.Dash, TokenType.Literal, TokenType.Colon, TokenType.Literal);
		assertTokenTypes('label:<123', TokenType.Literal, TokenType.Colon, TokenType.LessThan, TokenType.Number);

		assertTokenTypes('cats topics:>5', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.GreaterThan, TokenType.Number);
		assertTokenTypes('cats topics:>=5', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.GreaterThanEqual, TokenType.Number);
		assertTokenTypes('cats stars:<50', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.LessThan, TokenType.Number);
		assertTokenTypes('cats stars:<=50', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.LessThanEqual, TokenType.Number);
		assertTokenTypes('cats stars:10..*', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.Number, TokenType.RangeFixedStart);
		assertTokenTypes('cats stars:*..10', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.RangeFixedEnd, TokenType.Number);
		assertTokenTypes('cats created:<=2012-07-04', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.LessThanEqual, TokenType.Date);
		assertTokenTypes('cats pushed:2016-04-30..2016-07-04', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.Date, TokenType.Range, TokenType.Date);
		assertTokenTypes('cats pushed:*..2016-07-04', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.RangeFixedEnd, TokenType.Date);
		assertTokenTypes('cats pushed:2016-04-30..*', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.Date, TokenType.RangeFixedStart);
		assertTokenTypes('cats created:2017-01-01T01:00:00+07:00..2017-03-01T15:30:15+07:00', TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.DateTime, TokenType.Range, TokenType.DateTime);
		assertTokenTypes('hello NOT world', TokenType.Literal, TokenType.Whitespace, TokenType.Not, TokenType.Whitespace, TokenType.Literal);

		assertTokenTypes('cats stars:>10 -language:javascript',
			TokenType.Literal, TokenType.Whitespace, TokenType.Literal, TokenType.Colon, TokenType.GreaterThan, TokenType.Number, TokenType.Whitespace,
			TokenType.Dash, TokenType.Literal, TokenType.Colon, TokenType.Literal
		);

		assertTokenTypes('2020-03-11 2020-03-11', TokenType.Date, TokenType.Whitespace, TokenType.Date);
		assertTokenTypes('2020-03-11 Foo', TokenType.Date, TokenType.Whitespace, TokenType.Literal);

		assertTokenTypes('$BUG= "label:bug"', TokenType.VariableName, TokenType.Equals, TokenType.Whitespace, TokenType.QuotedLiteral);
		assertTokenTypes('$BUG=label:bug', TokenType.VariableName, TokenType.Equals, TokenType.Literal, TokenType.Colon, TokenType.Literal);

		assertTokenTypes('foo,bar', TokenType.Literal, TokenType.Comma, TokenType.Literal);
		assertTokenTypes('foo,"b,ar"', TokenType.Literal, TokenType.Comma, TokenType.QuotedLiteral);
	});
});
