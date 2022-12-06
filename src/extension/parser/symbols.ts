/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NodeType, QueryDocumentNode, Utils, VariableDefinitionNode } from "./nodes";

export enum ValueType {
	Number = 'number',
	Date = 'date',
	Literal = 'literal'
}

export interface SymbolInfo {
	root: QueryDocumentNode;
	name: string;
	def: VariableDefinitionNode;
	timestamp: number;
	type: ValueType | undefined;
	value: string;
}

export class SymbolTable {

	private readonly _clock = new class { private _value: number = 0; tick() { return this._value++; } };

	private readonly _data = new Map<string, SymbolInfo[]>();

	delete(id: string) {
		this._data.delete(id);
	}

	update(query: QueryDocumentNode) {

		// remove old
		this._data.delete(query.id);

		const getType = (def: VariableDefinitionNode) => {
			if (def.value._type !== NodeType.Query) {
				return;
			}
			if (def.value.nodes.length !== 1) {
				return;
			}
			return Utils.getTypeOfNode(def.value.nodes[0], this);
		};

		// add new - all defined variables
		for (let node of query.nodes) {
			if (node._type === NodeType.VariableDefinition) {
				let array = this._data.get(query.id);
				if (!array) {
					array = [];
					this._data.set(query.id, array);
				}
				array.push({
					root: query,
					timestamp: this._clock.tick(),
					name: node.name.value,
					def: node,
					type: getType(node),
					value: Utils.print(node.value, query.text, name => this.getFirst(name)?.value)
				});
			}
		}
	}

	getFirst(name: string): SymbolInfo | undefined {
		let candidate: SymbolInfo | undefined;
		for (let bucket of this._data.values()) {
			for (let info of bucket) {
				if (info.name === name) {
					if (!candidate || candidate.timestamp < info.timestamp) {
						candidate = info;
					}
				}
			}
		}
		return candidate;
	}

	*getAll(name: string): Iterable<SymbolInfo> {
		for (let bucket of this._data.values()) {
			for (let info of bucket) {
				if (info.name === name) {
					yield info;
				}
			}
		}
	}

	*all(): Iterable<SymbolInfo> {
		for (let bucket of this._data.values()) {
			for (let info of bucket) {
				yield info;
			}
		}
	}
}


export const enum ValuePlaceholderType {
	BaseBranch = 'baseBranch',
	HeadBranch = 'headBranch',
	Label = 'label',
	Language = 'language',
	Milestone = 'milestone',
	Orgname = 'orgname',
	ProjectBoard = 'projectBoard',
	Repository = 'repository',
	Teamname = 'teamname',
	Username = 'username',
}

export class ValueSet {

	readonly entries: Set<string>;

	constructor(
		readonly exclusive: boolean,
		...entries: string[]
	) {
		this.entries = new Set(entries);
	}
}

export const enum RepeatInfo {
	No,
	Repeat,
	RepeatNegated
}

class QualifiedValueInfo {

	static enum(sets: ValueSet | ValueSet[], repeatable?: RepeatInfo, description?: string) {
		return new QualifiedValueInfo(ValueType.Literal, Array.isArray(sets) ? sets : [sets], undefined, repeatable, false, description);
	}

	static placeholder(placeholder: ValuePlaceholderType, repeatable?: RepeatInfo, valueSequence?: boolean, description?: string) {
		return new QualifiedValueInfo(ValueType.Literal, undefined, placeholder, repeatable, valueSequence, description);
	}

	static simple(type: ValueType, description?: string) {
		return new QualifiedValueInfo(type, undefined, undefined, undefined, false, description);
	}

	static username(repeatable?: RepeatInfo, description?: string) {
		return new QualifiedValueInfo(ValueType.Literal, [new ValueSet(true, '@me')], ValuePlaceholderType.Username, repeatable, false, description);
	}

	constructor(
		readonly type: ValueType,
		readonly enumValues: readonly ValueSet[] | undefined,
		readonly placeholderType: ValuePlaceholderType | undefined,
		readonly repeatable: RepeatInfo = RepeatInfo.No,
		readonly valueSequence: boolean | undefined,
		readonly description: string | undefined
	) { }
}

//
export const QueryNodeImpliesPullRequestSchema = new Set<string>([
	'status',
	'base',
	'head',
	'draft',
	'review-requested',
	'review',
	'reviewed-by',
	'team-review-requested',
	'merged',
]);

export const QualifiedValueNodeSchema = new Map<string, QualifiedValueInfo>([
	// value sets
	['archived', QualifiedValueInfo.enum(new ValueSet(true, 'true', 'false'))],
	['draft', QualifiedValueInfo.enum(new ValueSet(true, 'true', 'false'), undefined, 'Draft pull requests')],
	['in', QualifiedValueInfo.enum(new ValueSet(true, 'title', 'body', 'comments'), undefined, 'Search in the title, body, comments, or any combination of these')],
	['is', QualifiedValueInfo.enum([new ValueSet(true, 'locked', 'unlocked'), new ValueSet(true, 'merged', 'unmerged'), new ValueSet(true, 'public', 'private'), new ValueSet(true, 'open', 'closed'), new ValueSet(true, 'pr', 'issue')], RepeatInfo.Repeat)],
	['reason', QualifiedValueInfo.enum(new ValueSet(true, 'completed', '"not planned"'))],
	['linked', QualifiedValueInfo.enum(new ValueSet(true, 'pr', 'issue'))],
	['no', QualifiedValueInfo.enum(new ValueSet(false, 'label', 'milestone', 'assignee', 'project'), RepeatInfo.Repeat)],
	['review', QualifiedValueInfo.enum(new ValueSet(true, 'none', 'required', 'approved', 'changes_requested'))],
	['state', QualifiedValueInfo.enum(new ValueSet(true, 'open', 'closed'), undefined, 'Issues and pull requests based on whether they are open or closed')],
	['status', QualifiedValueInfo.enum(new ValueSet(true, 'pending', 'success', 'failure'), undefined, 'Pull requests based on the status of the commits')],
	['type', QualifiedValueInfo.enum(new ValueSet(true, 'pr', 'issue'), undefined, 'Only issues or only pull requests')],
	['sort', QualifiedValueInfo.enum(new ValueSet(true,
		'created-desc', 'created-asc', 'comments-desc', 'comments-asc', 'updated-desc', 'updated-asc',
		'reactions-+1-desc', 'reactions--1-desc', 'reactions-smile-desc', 'reactions-tada-desc', 'reactions-thinking_face-desc', 'reactions-heart-desc', 'reactions-rocket-desc', 'reactions-eyes-desc',
		// 'reactions-+1-asc', 'reactions--1-asc', 'reactions-smile-asc', 'reactions-tada-asc', 'reactions-thinking_face-asc', 'reactions-heart-asc', 'reactions-rocket-asc', 'reactions-eyes-asc',
	))],
	// placeholder 
	['base', QualifiedValueInfo.placeholder(ValuePlaceholderType.BaseBranch)],
	['head', QualifiedValueInfo.placeholder(ValuePlaceholderType.HeadBranch)],
	['label', QualifiedValueInfo.placeholder(ValuePlaceholderType.Label, RepeatInfo.Repeat, true, 'Issues and pull requests with a certain label')],
	['language', QualifiedValueInfo.placeholder(ValuePlaceholderType.Language)],
	['milestone', QualifiedValueInfo.placeholder(ValuePlaceholderType.Milestone, undefined, false, 'Issues and pull requests for a certain miletsone')],
	['org', QualifiedValueInfo.placeholder(ValuePlaceholderType.Orgname, RepeatInfo.Repeat, false, 'Issues and pull requests in all repositories owned by a certain organization')],
	['project', QualifiedValueInfo.placeholder(ValuePlaceholderType.ProjectBoard)],
	['repo', QualifiedValueInfo.placeholder(ValuePlaceholderType.Repository, RepeatInfo.Repeat, false, 'Issues and pull requests in a certain repository')],
	['user', QualifiedValueInfo.username(RepeatInfo.Repeat, 'Issues and pull requests in all repositories owned by a certain user')],
	['team-review-requested', QualifiedValueInfo.placeholder(ValuePlaceholderType.Teamname)],
	['team', QualifiedValueInfo.placeholder(ValuePlaceholderType.Teamname)],
	// placeholder (username)
	['assignee', QualifiedValueInfo.username(RepeatInfo.RepeatNegated, 'Issues and pull requests that are assigned to a certain user')],
	['author', QualifiedValueInfo.username(RepeatInfo.RepeatNegated, 'Issues and pull requests created by a certain user')],
	['commenter', QualifiedValueInfo.username(RepeatInfo.Repeat, 'Issues and pull requests that contain a comment from a certain user')],
	['mentions', QualifiedValueInfo.username(RepeatInfo.Repeat, 'Issues and pull requests that mention a certain user')],
	['involves', QualifiedValueInfo.username(RepeatInfo.Repeat, 'Issues and pull requests that in some way involve a user. The involves qualifier is a logical OR between the author, assignee, mentions, and commenter qualifiers for a single user')],
	['review-requested', QualifiedValueInfo.username(undefined, 'Pull requests where a specific user is requested for review')],
	['reviewed-by', QualifiedValueInfo.username(undefined, 'Pull requests reviewed by a particular user')],
	// simple value
	['closed', QualifiedValueInfo.simple(ValueType.Date, 'Issues and pull requests based on when they were closed')],
	['created', QualifiedValueInfo.simple(ValueType.Date, 'Issues and pull requests based on when they were created')],
	['merged', QualifiedValueInfo.simple(ValueType.Date, 'Issues and pull requests based on when they were merged')],
	['pushed', QualifiedValueInfo.simple(ValueType.Date, 'Issues and pull requests based on when they were pushed')],
	['updated', QualifiedValueInfo.simple(ValueType.Date, 'Issues and pull requests based on when they were updated')],
	['comments', QualifiedValueInfo.simple(ValueType.Number, 'Issues and pull request by number of comments')],
	['interactions', QualifiedValueInfo.simple(ValueType.Number, 'Issues and pull request by number of interactions')],
	['reactions', QualifiedValueInfo.simple(ValueType.Number, 'Issues and pull request by number of reactions')],
	['size', QualifiedValueInfo.simple(ValueType.Number)],
	['stars', QualifiedValueInfo.simple(ValueType.Number)],
	['topics', QualifiedValueInfo.simple(ValueType.Number)],
]);
