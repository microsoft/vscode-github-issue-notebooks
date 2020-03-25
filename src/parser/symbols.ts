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

class QualifiedValueInfo {

	static enum(...sets: Set<string>[]) {
		return new QualifiedValueInfo(ValueType.Literal, sets, undefined);
	}

	static placeholder(placeholder: ValuePlaceholderType) {
		return new QualifiedValueInfo(ValueType.Literal, undefined, placeholder);
	}

	static simple(type: ValueType) {
		return new QualifiedValueInfo(type, undefined, undefined);
	}

	constructor(
		readonly type: ValueType,
		readonly enumValues: readonly Set<string>[] | undefined,
		readonly placeholderType: ValuePlaceholderType | undefined
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
	['type', QualifiedValueInfo.enum(new Set(['pr', 'issue']))],
	['updated', QualifiedValueInfo.simple(ValueType.Date)],
	['in', QualifiedValueInfo.enum(new Set(['title', 'body', 'comments']))],
	['org', QualifiedValueInfo.placeholder(ValuePlaceholderType.Orgname)],
	['repo', QualifiedValueInfo.placeholder(ValuePlaceholderType.Repository)],
	['user', QualifiedValueInfo.placeholder(ValuePlaceholderType.Username)],
	['state', QualifiedValueInfo.enum(new Set(['open', 'closed']))],
	['assignee', QualifiedValueInfo.placeholder(ValuePlaceholderType.Username)],
	['author', QualifiedValueInfo.placeholder(ValuePlaceholderType.Username)],
	['mentions', QualifiedValueInfo.placeholder(ValuePlaceholderType.Username)],
	['team', QualifiedValueInfo.placeholder(ValuePlaceholderType.Teamname)],
	['stars', QualifiedValueInfo.simple(ValueType.Number)],
	['topics', QualifiedValueInfo.simple(ValueType.Number)],
	['pushed', QualifiedValueInfo.simple(ValueType.Date)],
	['size', QualifiedValueInfo.simple(ValueType.Number)],
	['commenter', QualifiedValueInfo.placeholder(ValuePlaceholderType.Username)],
	['involves', QualifiedValueInfo.placeholder(ValuePlaceholderType.Username)],
	['label', QualifiedValueInfo.placeholder(ValuePlaceholderType.Label)],
	['linked', QualifiedValueInfo.enum(new Set(['pr', 'issue']))],
	['milestone', QualifiedValueInfo.placeholder(ValuePlaceholderType.Milestone)],
	['project', QualifiedValueInfo.placeholder(ValuePlaceholderType.ProjectBoard)],
	['language', QualifiedValueInfo.placeholder(ValuePlaceholderType.Language)],
	['comments', QualifiedValueInfo.simple(ValueType.Number)],
	['interactions', QualifiedValueInfo.simple(ValueType.Number)],
	['reactions', QualifiedValueInfo.simple(ValueType.Number)],
	['created', QualifiedValueInfo.simple(ValueType.Date)],
	['closed', QualifiedValueInfo.simple(ValueType.Date)],
	['archived', QualifiedValueInfo.enum(new Set(['true', 'false']))],
	['is', QualifiedValueInfo.enum(new Set(['locked', 'unlocked']), new Set(['merged', 'unmerged']), new Set(['public', 'private']), new Set(['open', 'closed']), new Set(['pr', 'issue']))],
	['no', QualifiedValueInfo.enum(new Set(['label', 'milestone', 'assignee', 'project']))],
	['status', QualifiedValueInfo.enum(new Set(['pending', 'success', 'failure']))],
	['base', QualifiedValueInfo.placeholder(ValuePlaceholderType.BaseBranch)],
	['head', QualifiedValueInfo.placeholder(ValuePlaceholderType.HeadBranch)],
	['draft', QualifiedValueInfo.enum(new Set(['true', 'false']))],
	['review-requested', QualifiedValueInfo.placeholder(ValuePlaceholderType.Username)],
	['review', QualifiedValueInfo.enum(new Set(['none', 'required', 'approved']))],
	['reviewed-by', QualifiedValueInfo.placeholder(ValuePlaceholderType.Username)],
	['team-review-requested', QualifiedValueInfo.placeholder(ValuePlaceholderType.Teamname)],
	['merged', QualifiedValueInfo.simple(ValueType.Date)],
]);

export const SortByNodeSchema = new Set<string>([
	'comments', 'reactions', 'reactions-+1', 'reactions--1', 'reactions-smile',
	'reactions-thinking_face', 'reactions-heart', 'reactions-tada', 'created', 'updated'
]);
