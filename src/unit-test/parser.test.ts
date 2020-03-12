/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import { Scanner, TokenType, NodeType, Parser } from '../parser/parser';
import * as assert from 'assert';

suite('Scanner', function () {

    function assertTokenTypes(str: string, ...expected: TokenType[]) {
        const scanner = new Scanner(str);
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

        // assertTokenTypes('', TokenType.Macro);
        assertTokenTypes('Foo', TokenType.Literal);
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
    });
});


suite('Parser', function () {

    function assertNodeTypes(input: string, ...types: NodeType[]) {
        const parser = new Parser();
        let nodes = parser.parse(input).nodes;
        nodes.forEach((node, i) => {
            assert.equal(node._type, types[i], input.substring(node.start, node.end));
        });
        assert.equal(nodes.length, types.length);
    }

    function assertNodeTypesDeep(input: string, ...types: NodeType[]) {
        const parser = new Parser();
        const syntax = parser.parse(input);
        let actual: NodeType[] = [];
        syntax.visit(node => actual.push(node._type));
        assert.deepEqual(actual, types, input);
    }

    test('QualifiedValue', function () {
        assertNodeTypes('label:foo', NodeType.QualifiedValue);
        assertNodeTypes('label:"foo bar"', NodeType.QualifiedValue);
        assertNodeTypes('-label:foo', NodeType.QualifiedValue);
        assertNodeTypes('label:>=12', NodeType.QualifiedValue);
        assertNodeTypes('label:>12', NodeType.QualifiedValue);
        assertNodeTypes('label:<12', NodeType.QualifiedValue);
        assertNodeTypes('label:<=12', NodeType.QualifiedValue);
        assertNodeTypes('label:*..12', NodeType.QualifiedValue);
        assertNodeTypes('label:12..*', NodeType.QualifiedValue);
        assertNodeTypes('label:12..23', NodeType.QualifiedValue);
    });

    test('Sequence', function () {
        assertNodeTypes('label: foo', NodeType.QualifiedValue, NodeType.Literal);
        assertNodeTypes('label:foo bar', NodeType.QualifiedValue, NodeType.Literal);
        assertNodeTypes('label:foo bar NOT bazz', NodeType.QualifiedValue, NodeType.Literal, NodeType.Any, NodeType.Literal);
        assertNodeTypes('label:foo bar 0cafecafe bazz', NodeType.QualifiedValue, NodeType.Literal, NodeType.Any, NodeType.Literal);
    });

    test('Sequence (deep)', function () {
        assertNodeTypesDeep('label: foo', NodeType.QualifiedValue, NodeType.Literal, NodeType.Missing, NodeType.Literal);
        assertNodeTypesDeep('label:foo', NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('label:123', NodeType.QualifiedValue, NodeType.Literal, NodeType.Number);
        assertNodeTypesDeep('label:"123"', NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('label:"foo bar"', NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('"label":foo', NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('-label:"foo"', NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('label:foo bar NOT bazz', NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal, NodeType.Literal, NodeType.Any, NodeType.Literal);
        assertNodeTypesDeep('label:cafecafe bazz', NodeType.QualifiedValue, NodeType.Literal, NodeType.Any, NodeType.Literal);
        assertNodeTypesDeep('label:"sss" dd"', NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal, NodeType.Literal, NodeType.Any);
    });

});
