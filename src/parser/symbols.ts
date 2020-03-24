/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryDocumentNode, Node, Utils, NodeType, VariableDefinitionNode } from "./nodes";
import { Uri } from "vscode";

export enum ValueType {
	Query = 'query',
	Number = 'number',
	Date = 'date',
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

export type Value = ValueType | Set<string>[];

const qualifiers = new Map<string, Value>([
	['type', [new Set(['pr', 'issue'])]],
	['updated', ValueType.Date],
	['in', [new Set(['title', 'body', 'comments'])]],
	['org', ValueType.Orgname],
	['repo', ValueType.Repository],
	['user', ValueType.Username],
	['state', [new Set(['open', 'closed'])]],
	['assignee', ValueType.Username],
	['author', ValueType.Username],
	['mentions', ValueType.Username],
	['team', ValueType.Teamname],
	['stars', ValueType.Number],
	['topics', ValueType.Number],
	['pushed', ValueType.Date],
	['size', ValueType.Number],
	['commenter', ValueType.Username],
	['involves', ValueType.Username],
	['label', ValueType.Label],
	['linked', [new Set(['pr', 'issue'])]],
	['milestone', ValueType.Milestone],
	['project', ValueType.ProjectBoard],
	['language', ValueType.Language],
	['comments', ValueType.Number],
	['interactions', ValueType.Number],
	['reactions', ValueType.Number],
	['created', ValueType.Date],
	['closed', ValueType.Date],
	['archived', [new Set(['true', 'false'])]],
	['is', [new Set(['locked', 'unlocked']), new Set(['merged', 'unmerged']), new Set(['public', 'private']), new Set(['open', 'closed']), new Set(['pr', 'issue'])]],
	['no', [new Set(['label', 'milestone', 'assignee', 'project'])]],
	['status', [new Set(['pending', 'success', 'failure'])]],
	['base', ValueType.BaseBranch],
	['head', ValueType.HeadBranch],
	['draft', [new Set(['true', 'false'])]],
	['review-requested', ValueType.Username],
	['review', [new Set(['none', 'required', 'approved'])]],
	['reviewed-by', ValueType.Username],
	['team-review-requested', ValueType.Teamname],
	['merged', ValueType.Date],
]);


export const requiresPrType = new Set<string>([
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


export const sortValues = new Set<string>([
	'comments', 'reactions', 'reactions-+1', 'reactions--1', 'reactions-smile',
	'reactions-thinking_face', 'reactions-heart', 'reactions-tada', 'created', 'updated'
]);

export const enum SymbolKind {
	User, Static
}

export interface UserSymbol {
	kind: SymbolKind.User;
	name: string;
	uri: Uri;
	def: VariableDefinitionNode;
	timestamp: number;
	type: ValueType;
}

export interface StaticSymbol {
	kind: SymbolKind.Static;
	name: string;
	value: Value;
}

export type SymbolInfo = UserSymbol | StaticSymbol;

export class SymbolTable {

	private readonly _data = new Set<SymbolInfo>();

	constructor() {
		// given variables
		for (let [key, value] of qualifiers) {
			this._data.add({
				kind: SymbolKind.Static,
				name: key,
				value
			});
		}
	}

	update(query: QueryDocumentNode, uri: Uri) {

		// remove old
		for (let value of this._data) {
			if (value.kind === SymbolKind.User && value.uri.toString() === uri.toString()) {
				this._data.delete(value);
			}
		}

		const getType = (def: VariableDefinitionNode): ValueType => {
			if (def.value._type !== NodeType.Query) {
				return ValueType.Query;
			}
			if (def.value.nodes.length !== 1) {
				return ValueType.Query;
			}
			const [node] = def.value.nodes;
			switch (node._type) {
				case NodeType.Compare:
					// foo:>number/data
					if (node.value._type === NodeType.Date) {
						return ValueType.Date;
					} else if (node.value._type === NodeType.Number) {
						return ValueType.Number;
					} else {
						return ValueType.Query;
					}
				case NodeType.Range:
					// foo:date/number..date/number
					if (node.open?._type === NodeType.Date || node.close?._type === NodeType.Date) {
						return ValueType.Date;
					} else if (node.open?._type === NodeType.Number || node.close?._type === NodeType.Number) {
						return ValueType.Number;
					} else {
						return ValueType.Query;
					}
				case NodeType.Date:
					return ValueType.Date;
				case NodeType.Number:
					return ValueType.Number;
				case NodeType.VariableName:
					return this._findUserSymbol(node.value)?.type ?? ValueType.Query;
			}

			return ValueType.Query;
		};

		// add new - all defined variables
		Utils.walk(query, node => {
			if (node._type === NodeType.VariableDefinition) {
				this._data.add({
					timestamp: Date.now(),
					kind: SymbolKind.User,
					name: node.name.value,
					def: node,
					uri,
					type: getType(node)
				});
			}
		});
	}

	private _findUserSymbol(name: string): UserSymbol | undefined {
		let candidates: UserSymbol[] = [];
		for (let info of this._data) {
			if (info.name === name && info.kind === SymbolKind.User) {
				candidates.push(info);
			}
		}
		return candidates.sort(SymbolTable.compareByTimestamp)[0];
	}

	getFirst(name: string): SymbolInfo | undefined {
		for (let info of this._data) {
			if (info.name === name) {
				return info;
			}
		}
	}

	* getAll(name: string): Iterable<SymbolInfo> {
		for (let info of this._data) {
			if (info.name === name) {
				yield info;
			}
		}
	}

	all(): Iterable<SymbolInfo> {
		return this._data;
	}

	static compareByTimestamp(a: UserSymbol, b: UserSymbol): number {
		return a.timestamp - b.timestamp;
	}
}
