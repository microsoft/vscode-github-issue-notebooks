/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryDocumentNode, Node, Utils, NodeType, VariableDefinitionNode } from "./nodes";

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

class QualifiedValueInfo {

	static enum(sets: ValueSet | ValueSet[], repeatable?: boolean) {
		return new QualifiedValueInfo(ValueType.Literal, Array.isArray(sets) ? sets : [sets], undefined, repeatable);
	}

	static placeholder(placeholder: ValuePlaceholderType, repeatable?: boolean) {
		return new QualifiedValueInfo(ValueType.Literal, undefined, placeholder, repeatable);
	}

	static simple(type: ValueType) {
		return new QualifiedValueInfo(type, undefined, undefined);
	}

	static username(repeatable?: boolean) {
		return new QualifiedValueInfo(ValueType.Literal, [new ValueSet(true, '@me')], ValuePlaceholderType.Username, repeatable);
	}

	constructor(
		readonly type: ValueType,
		readonly enumValues: readonly ValueSet[] | undefined,
		readonly placeholderType: ValuePlaceholderType | undefined,
		readonly repeatable: boolean = false
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
	['is', QualifiedValueInfo.enum([new ValueSet(true, 'locked', 'unlocked'), new ValueSet(true, 'merged', 'unmerged'), new ValueSet(true, 'public', 'private'), new ValueSet(true, 'open', 'closed'), new ValueSet(true, 'pr', 'issue')], true)],
	['linked', QualifiedValueInfo.enum(new ValueSet(true, 'pr', 'issue'))],
	['no', QualifiedValueInfo.enum(new ValueSet(false, 'label', 'milestone', 'assignee', 'project'), true)],
	['review', QualifiedValueInfo.enum(new ValueSet(true, 'none', 'required', 'approved'))],
	['state', QualifiedValueInfo.enum(new ValueSet(true, 'open', 'closed'))],
	['status', QualifiedValueInfo.enum(new ValueSet(true, 'pending', 'success', 'failure'))],
	['type', QualifiedValueInfo.enum(new ValueSet(true, 'pr', 'issue'))],
	// placeholder 
	['base', QualifiedValueInfo.placeholder(ValuePlaceholderType.BaseBranch)],
	['head', QualifiedValueInfo.placeholder(ValuePlaceholderType.HeadBranch)],
	['label', QualifiedValueInfo.placeholder(ValuePlaceholderType.Label, true)],
	['language', QualifiedValueInfo.placeholder(ValuePlaceholderType.Language)],
	['milestone', QualifiedValueInfo.placeholder(ValuePlaceholderType.Milestone)],
	['org', QualifiedValueInfo.placeholder(ValuePlaceholderType.Orgname, true)],
	['project', QualifiedValueInfo.placeholder(ValuePlaceholderType.ProjectBoard)],
	['repo', QualifiedValueInfo.placeholder(ValuePlaceholderType.Repository, true)],
	['team-review-requested', QualifiedValueInfo.placeholder(ValuePlaceholderType.Teamname)],
	['team', QualifiedValueInfo.placeholder(ValuePlaceholderType.Teamname)],
	// placeholder (username)
	['assignee', QualifiedValueInfo.username()],
	['author', QualifiedValueInfo.username()],
	['commenter', QualifiedValueInfo.username(true)],
	['involves', QualifiedValueInfo.username(true)],
	['mentions', QualifiedValueInfo.username()],
	['review-requested', QualifiedValueInfo.username()],
	['reviewed-by', QualifiedValueInfo.username()],
	['user', QualifiedValueInfo.username()],
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

export const SortByNodeSchema = new Set<string>([
	'comments', 'reactions', 'reactions-+1', 'reactions--1', 'reactions-smile',
	'reactions-thinking_face', 'reactions-heart', 'reactions-tada', 'created', 'updated'
]);
