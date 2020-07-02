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

	private readonly _data = new Map<string, SymbolInfo[]>();

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
					timestamp: Date.now(),
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

class ValueSet {

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

	static enum(sets: ValueSet | ValueSet[], repeatable?: RepeatInfo) {
		return new QualifiedValueInfo(ValueType.Literal, Array.isArray(sets) ? sets : [sets], undefined, repeatable);
	}

	static placeholder(placeholder: ValuePlaceholderType, repeatable?: RepeatInfo) {
		return new QualifiedValueInfo(ValueType.Literal, undefined, placeholder, repeatable);
	}

	static simple(type: ValueType) {
		return new QualifiedValueInfo(type, undefined, undefined);
	}

	static username(repeatable?: RepeatInfo) {
		return new QualifiedValueInfo(ValueType.Literal, [new ValueSet(true, '@me')], ValuePlaceholderType.Username, repeatable);
	}

	constructor(
		readonly type: ValueType,
		readonly enumValues: readonly ValueSet[] | undefined,
		readonly placeholderType: ValuePlaceholderType | undefined,
		readonly repeatable: RepeatInfo = RepeatInfo.No
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
	['draft', QualifiedValueInfo.enum(new ValueSet(true, 'true', 'false'))],
	['in', QualifiedValueInfo.enum(new ValueSet(true, 'title', 'body', 'comments'))],
	['is', QualifiedValueInfo.enum([new ValueSet(true, 'locked', 'unlocked'), new ValueSet(true, 'merged', 'unmerged'), new ValueSet(true, 'public', 'private'), new ValueSet(true, 'open', 'closed'), new ValueSet(true, 'pr', 'issue')], RepeatInfo.Repeat)],
	['linked', QualifiedValueInfo.enum(new ValueSet(true, 'pr', 'issue'))],
	['no', QualifiedValueInfo.enum(new ValueSet(false, 'label', 'milestone', 'assignee', 'project'), RepeatInfo.Repeat)],
	['review', QualifiedValueInfo.enum(new ValueSet(true, 'none', 'required', 'approved'))],
	['state', QualifiedValueInfo.enum(new ValueSet(true, 'open', 'closed'))],
	['status', QualifiedValueInfo.enum(new ValueSet(true, 'pending', 'success', 'failure'))],
	['type', QualifiedValueInfo.enum(new ValueSet(true, 'pr', 'issue'))],
	['sort', QualifiedValueInfo.enum(new ValueSet(true,
		'created-desc', 'created-asc', 'comments-desc', 'comments-asc', 'updated-desc', 'updated-asc',
		'reactions-+1-desc', 'reactions--1-desc', 'reactions-smile-desc', 'reactions-tada-desc', 'reactions-thinking_face-desc', 'reactions-heart-desc', 'reactions-rocket-desc', 'reactions-eyes-desc',
		// 'reactions-+1-asc', 'reactions--1-asc', 'reactions-smile-asc', 'reactions-tada-asc', 'reactions-thinking_face-asc', 'reactions-heart-asc', 'reactions-rocket-asc', 'reactions-eyes-asc',
	))],
	// placeholder 
	['base', QualifiedValueInfo.placeholder(ValuePlaceholderType.BaseBranch)],
	['head', QualifiedValueInfo.placeholder(ValuePlaceholderType.HeadBranch)],
	['label', QualifiedValueInfo.placeholder(ValuePlaceholderType.Label, RepeatInfo.Repeat)],
	['language', QualifiedValueInfo.placeholder(ValuePlaceholderType.Language)],
	['milestone', QualifiedValueInfo.placeholder(ValuePlaceholderType.Milestone)],
	['org', QualifiedValueInfo.placeholder(ValuePlaceholderType.Orgname, RepeatInfo.Repeat)],
	['project', QualifiedValueInfo.placeholder(ValuePlaceholderType.ProjectBoard)],
	['repo', QualifiedValueInfo.placeholder(ValuePlaceholderType.Repository, RepeatInfo.Repeat)],
	['team-review-requested', QualifiedValueInfo.placeholder(ValuePlaceholderType.Teamname)],
	['team', QualifiedValueInfo.placeholder(ValuePlaceholderType.Teamname)],
	// placeholder (username)
	['assignee', QualifiedValueInfo.username(RepeatInfo.RepeatNegated)],
	['author', QualifiedValueInfo.username(RepeatInfo.RepeatNegated)],
	['commenter', QualifiedValueInfo.username(RepeatInfo.Repeat)],
	['involves', QualifiedValueInfo.username(RepeatInfo.Repeat)],
	['mentions', QualifiedValueInfo.username(RepeatInfo.Repeat)],
	['review-requested', QualifiedValueInfo.username()],
	['reviewed-by', QualifiedValueInfo.username()],
	['user', QualifiedValueInfo.username(RepeatInfo.Repeat)],
	// simple value
	['closed', QualifiedValueInfo.simple(ValueType.Date)],
	['comments', QualifiedValueInfo.simple(ValueType.Number)],
	['created', QualifiedValueInfo.simple(ValueType.Date)],
	['interactions', QualifiedValueInfo.simple(ValueType.Number)],
	['merged', QualifiedValueInfo.simple(ValueType.Date)],
	['pushed', QualifiedValueInfo.simple(ValueType.Date)],
	['reactions', QualifiedValueInfo.simple(ValueType.Number)],
	['size', QualifiedValueInfo.simple(ValueType.Number)],
	['stars', QualifiedValueInfo.simple(ValueType.Number)],
	['topics', QualifiedValueInfo.simple(ValueType.Number)],
	['updated', QualifiedValueInfo.simple(ValueType.Date)],
]);
