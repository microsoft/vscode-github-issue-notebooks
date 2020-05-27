/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import { NodeType, QueryNode, Utils } from '../parser/nodes';
import { Parser } from '../parser/parser';
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
		Utils.walk(query, node => actual.push(node._type));
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

		// assertNodeTypes('comments:>=10 \n$bar=label:bug', NodeType.QualifiedValue, NodeType.VariableDefinition);
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
		assertNodeTypesDeep('$a=label:bug', NodeType.VariableDefinition, NodeType.VariableName, NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Literal);
		assertNodeTypesDeep('foo OR BAR', NodeType.OrExpression, NodeType.Query, NodeType.Literal, NodeType.Query, NodeType.Literal);
		assertNodeTypesDeep('foo //nothing', NodeType.Query, NodeType.Literal);
	});

	test('Query with sortby', function () {
		assertNodeTypes('label:foo sort asc by comments', NodeType.QualifiedValue);
		assertNodeTypes('label:foo sortby sort desc by comments', NodeType.QualifiedValue, NodeType.Literal);
		assertNodeTypesDeep('label:123 sort asc by sort asc by comments', NodeType.Query, NodeType.QualifiedValue, NodeType.Literal, NodeType.Number, NodeType.SortBy, NodeType.Missing, NodeType.SortBy, NodeType.Literal);
	});
});


suite('Print Nodes', function () {

	function assertPrinted(text: string, expected: string[] = [text], values = new Map<string, string>()) {
		const query = new Parser().parse(text);
		const actual: string[] = [];
		Utils.walk(query, node => {
			if (node._type === NodeType.Query) {
				actual.push(Utils.print(node, text, name => values.get(name)));
			}
		});
		assert.deepEqual(actual, expected);
	}

	test('simple', function () {
		assertPrinted('label:bug');
		assertPrinted('-label:bug');
		assertPrinted('assignee:@me');
		assertPrinted('comments:10..20');
		assertPrinted('comments:10..*');
		assertPrinted('comments:*..20');
		assertPrinted('created:>=2020-03-22');
		assertPrinted('foo NOT bar');
		assertPrinted('foo NOT bar //comment', ['foo NOT bar']);
	});

	test('print bogous nodes', function () {
		assertPrinted('label:bug');
		assertPrinted('label:bug123');
		assertPrinted('label=bug');
		assertPrinted('label=bug foo=b#ar');
		assertPrinted('label=bug foo=2020-04-19ar');
	});

	test('or-expression', function () {
		assertPrinted('label:bug OR label:foo', ['label:bug', 'label:foo']);
		assertPrinted('label:bug OR label:foo OR label:"123"', ['label:bug', 'label:foo', 'label:"123"']);
		assertPrinted('label:bug OR');
		assertPrinted('OR label:bug');
		assertPrinted('aaa OR bbb', ['aaa', 'bbb']);
		assertPrinted('aaa or bbb', ['aaa or bbb']);
	});

	test('variables', function () {
		assertPrinted('label:$zzz', ['label:xxx'], new Map([['$zzz', 'xxx']]));
		assertPrinted('label:$zzz', ['label:$zzz'], new Map());
		assertPrinted('label:$zzz OR foo $zzz', ['label:xxx', 'foo xxx'], new Map([['$zzz', 'xxx']]));
	});


	test('GH Samples', function () {
		// all from https://help.github.com/en/github/searching-for-information-on-github/understanding-the-search-syntax
		assertPrinted('cats stars:>1000');
		assertPrinted('cats topics:>=5');
		assertPrinted('cats size:<10000');
		assertPrinted('cats stars:<=50');
		assertPrinted('cats stars:10..*');
		assertPrinted('cats stars:*..10');
		assertPrinted('cats stars:10..50');
		assertPrinted('cats created:>2016-04-29');
		assertPrinted('cats created:>=2017-04-01');
		assertPrinted('cats pushed:<2012-07-05');
		assertPrinted('cats created:<=2012-07-04');
		assertPrinted('cats pushed:2016-04-30..2016-07-04');
		assertPrinted('cats created:2012-04-30..*');
		assertPrinted('cats created:*..2012-04-30');
		assertPrinted('cats created:2017-01-01T01:00:00+07:00..2017-03-01T15:30:15+07:00');
		assertPrinted('cats created:2016-03-21T14:11:00Z..2016-04-07T20:45:00Z');
		assertPrinted('hello NOT world');
		assertPrinted('cats stars:>10 -language:javascript');
		assertPrinted('mentions:defunkt -org:github');
		assertPrinted('cats NOT "hello world"');
		assertPrinted('build label:"bug fix"');
		assertPrinted('author:nat');
		assertPrinted('is:issue assignee:@me');
	});

	test('GH Samples 2', function () {
		// https://help.github.com/en/github/searching-for-information-on-github/searching-issues-and-pull-requests
		// USE [...document.querySelectorAll('a[href*="https://github.com/search?"]')].map(a => a.textContent).join('\n')
		assertPrinted('cat type:pr');
		assertPrinted('github commenter:defunkt type:issue');
		assertPrinted('warning in:title');
		assertPrinted('error in:title,body');
		assertPrinted('shipit in:comments');
		assertPrinted('user:defunkt ubuntu');
		assertPrinted('org:github');
		assertPrinted('repo:mozilla/shumway created:<2012-03-01');
		assertPrinted('performance is:open is:issue');
		assertPrinted('is:public');
		assertPrinted('is:private cupcake');
		assertPrinted('cool author:gjtorikian');
		assertPrinted('bootstrap in:body author:mdo');
		assertPrinted('author:app/robot');
		assertPrinted('resque mentions:defunkt');
		assertPrinted('involves:defunkt involves:jlord');
		assertPrinted('NOT bootstrap in:body involves:mdo');
		assertPrinted('repo:desktop/desktop is:open linked:pr');
		assertPrinted('repo:desktop/desktop is:closed linked:issue');
		assertPrinted('repo:desktop/desktop is:open -linked:pr');
		assertPrinted('repo:desktop/desktop is:open -linked:issue');
		assertPrinted('broken in:body -label:bug label:priority');
		assertPrinted('e1109ab');
		assertPrinted('0eff326d6213c is:merged');
		assertPrinted('language:ruby state:open');
		assertPrinted('state:closed comments:>100');
		assertPrinted('comments:500..1000');
		assertPrinted('interactions:>2000');
		assertPrinted('interactions:500..1000');
		assertPrinted('reactions:>1000');
		assertPrinted('reactions:500..1000');
		assertPrinted('draft:true');
		assertPrinted('draft:false');
		assertPrinted('type:pr team-review-requested:atom/design');
		assertPrinted('language:c# created:<2011-01-01 state:open');
		assertPrinted('weird in:body updated:>=2013-02-01');
		assertPrinted('language:swift closed:>2014-06-11');
		assertPrinted('language:javascript merged:<2011-01-01');
		assertPrinted('fast in:title language:ruby merged:>=2014-05-01');
		assertPrinted('archived:true GNOME');
		assertPrinted('archived:false GNOME');
		assertPrinted('code of conduct is:locked is:issue archived:false');
		assertPrinted('code of conduct is:unlocked is:issue archived:false');
		assertPrinted('priority no:label');
		assertPrinted('sprint no:milestone type:issue');
		assertPrinted('important no:assignee language:java type:issue');
	});

	test('Show Error/Warning when the query is invalid #24', function () {
		// https://github.com/microsoft/vscode-github-issue-notebooks/issues/24
		assertPrinted('fooBar -assignee:@me sort asc by created', ['fooBar -assignee:@me']);
		assertPrinted('fooBar sort asc by created -assignee:@me');
	});
});
