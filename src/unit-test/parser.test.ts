/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import { NodeType, QueryNode } from '../parser/nodes';
import { Parser } from '../parser/parser';
import { Utils } from "../parser/nodes";
import * as assert from 'assert';

suite('Parser', function () {

    function assertNodeTypes(input: string, ...types: NodeType[]) {
        const parser = new Parser();
        const nodes = parser.parse(input).nodes;
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0]._type, NodeType.Query);

        (<QueryNode>nodes[0]).nodes.forEach((node, i) => {
            assert.equal(node._type, types[i], input.substring(node.start, node.end));
        });
        assert.equal((<QueryNode>nodes[0]).nodes.length, types.length);
    }

    function assertNodeTypesDeep(input: string, ...types: NodeType[]) {
        const parser = new Parser();
        const query = parser.parse(input);
        const actual: NodeType[] = [];
        Utils.visit(query, node => actual.push(node._type));
        types.unshift(NodeType.QueryDocument);
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
        assertNodeTypesDeep('label: foo', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Missing, NodeType.Literal);
        assertNodeTypesDeep('label:foo', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('label:123', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Number);
        assertNodeTypesDeep('label:"123"', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('label:"foo bar"', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('"label":foo', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('-label:"foo"', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('label:foo bar NOT bazz', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal, NodeType.Literal, NodeType.Any, NodeType.Literal);
        assertNodeTypesDeep('label:cafecafe bazz', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Any, NodeType.Literal);
        assertNodeTypesDeep('label:"sss" dd"', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal, NodeType.Literal, NodeType.Any);
        assertNodeTypesDeep('$BUG=label:bug', NodeType.VariableDefinition, NodeType.VariableName, NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
        assertNodeTypesDeep('foo OR BAR', NodeType.OrExpression, NodeType.Query, NodeType.Literal, NodeType.Query, NodeType.Literal);
    });

});
