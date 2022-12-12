/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Token, TokenType } from "./scanner";
import { SymbolTable, ValueType } from "./symbols";

export const enum NodeType {
	Any = 'Any',
	Compare = 'Compare',
	Date = 'Date',
	Literal = 'Literal',
	LiteralSequence = 'LiteralSequence',
	Missing = 'Missing',
	Number = 'Number',
	OrExpression = 'OrExpression',
	QualifiedValue = 'QualifiedValue',
	Query = 'Query',
	QueryDocument = 'QueryDocument',
	Range = 'Range',
	VariableDefinition = 'VariableDefinition',
	VariableName = 'VariableName',
}

interface BaseNode {
	start: number;
	end: number;
}

export interface AnyNode extends BaseNode {
	_type: NodeType.Any;
	tokenType: TokenType;
}

export interface MissingNode extends BaseNode {
	_type: NodeType.Missing;
	expected: NodeType[];
	optional?: boolean;
}

export interface LiteralNode extends BaseNode {
	_type: NodeType.Literal;
	value: string;
}

export interface LiteralSequenceNode extends BaseNode {
	_type: NodeType.LiteralSequence;
	nodes: LiteralNode[];
}

export interface NumberNode extends BaseNode {
	_type: NodeType.Number;
	value: number;
}

export interface DateNode extends BaseNode {
	_type: NodeType.Date;
	value: string;
}

export interface CompareNode extends BaseNode {
	_type: NodeType.Compare;
	cmp: string;
	value: DateNode | NumberNode | VariableNameNode | MissingNode;
}

export interface RangeNode extends BaseNode {
	_type: NodeType.Range,
	open: NumberNode | DateNode | VariableNameNode | undefined;
	close: NumberNode | DateNode | VariableNameNode | MissingNode | undefined;
}

export interface QualifiedValueNode extends BaseNode {
	_type: NodeType.QualifiedValue;
	not: boolean;
	qualifier: LiteralNode;
	value: CompareNode | RangeNode | DateNode | NumberNode | VariableNameNode | LiteralNode | LiteralSequenceNode | AnyNode | MissingNode;
}

export interface VariableNameNode extends BaseNode {
	_type: NodeType.VariableName;
	value: string;
}

export interface VariableDefinitionNode extends BaseNode {
	_type: NodeType.VariableDefinition;
	name: VariableNameNode;
	value: QueryNode | MissingNode;
}

export interface QueryNode extends BaseNode {
	_type: NodeType.Query;
	nodes: (QualifiedValueNode | NumberNode | DateNode | VariableNameNode | LiteralNode | AnyNode)[];
}

export interface OrExpressionNode extends BaseNode {
	_type: NodeType.OrExpression;
	or: Token & { type: TokenType.OR; };
	left: QueryNode;
	right: QueryNode | OrExpressionNode;
}

export interface QueryDocumentNode extends BaseNode {
	_type: NodeType.QueryDocument;
	text: string;
	id: string;
	nodes: (QueryNode | OrExpressionNode | VariableDefinitionNode)[];
}

export type SimpleNode = VariableNameNode | QualifiedValueNode | RangeNode | CompareNode | DateNode | NumberNode | LiteralNode | LiteralSequenceNode | MissingNode | AnyNode;

export type Node = QueryDocumentNode // level 1
	| QueryNode | OrExpressionNode | VariableDefinitionNode // level 2
	| SimpleNode;


export interface NodeVisitor {
	(node: Node, parent: Node | undefined): any;
}

export namespace Utils {
	export function walk(node: Node, callback: NodeVisitor) {
		if (!node) {
			return;
		}
		const stack: Array<Node | undefined> = [undefined, node]; //parent, node
		while (stack.length > 0) {
			let parent = stack.shift();
			let node = stack.shift();
			if (!node) {
				continue;
			}
			callback(node, parent);
			switch (node._type) {
				case NodeType.Compare:
					stack.unshift(node.value);
					stack.unshift(node);
					break;
				case NodeType.Range:
					stack.unshift(node.close);
					stack.unshift(node);
					stack.unshift(node.open);
					stack.unshift(node);
					break;
				case NodeType.QualifiedValue:
					stack.unshift(node.value);
					stack.unshift(node);
					stack.unshift(node.qualifier);
					stack.unshift(node);
					break;
				case NodeType.VariableDefinition:
					stack.unshift(node.value);
					stack.unshift(node);
					stack.unshift(node.name);
					stack.unshift(node);
					break;
				case NodeType.OrExpression:
					stack.unshift(node.right);
					stack.unshift(node);
					stack.unshift(node.left);
					stack.unshift(node);
					break;
				case NodeType.LiteralSequence:
				case NodeType.Query:
				case NodeType.QueryDocument:
					for (let i = node.nodes.length - 1; i >= 0; i--) {
						stack.unshift(node.nodes[i]);
						stack.unshift(node);
					}
					break;
			}
		}
	}

	export function nodeAt(node: Node, offset: number, parents?: Node[]): Node | undefined {
		let result: Node | undefined;
		Utils.walk(node, node => {
			if (Utils.containsPosition(node, offset)) {
				parents?.push(node);
				result = node;
			}
		});
		return result;
	}

	export function containsPosition(node: Node, offset: number): boolean {
		return node.start <= offset && offset <= node.end;
	}


	export type PrintableNode = Exclude<Node, OrExpressionNode | QueryDocumentNode | VariableDefinitionNode>;

	export function print(node: PrintableNode, text: string, variableValue: (name: string) => string | undefined): string {

		function _print(node: PrintableNode): string {
			switch (node._type) {
				case NodeType.Missing:
					// no value for those
					return '';
				case NodeType.VariableName:
					// look up variable (must be defined first)
					return variableValue(node.value) ?? `${node.value}`;
				case NodeType.Any:
				case NodeType.Literal:
				case NodeType.Date:
				case NodeType.Number:
					return text.substring(node.start, node.end);
				case NodeType.LiteralSequence:
					return node.nodes.map(_print).join(',');
				case NodeType.Compare:
					// >=aaa etc
					return `${node.cmp}${_print(node.value)}`;
				case NodeType.Range:
					// aaa..bbb, *..ccc, ccc..*
					return node.open && node.close
						? `${_print(node.open)}..${_print(node.close)}`
						: node.open ? `${_print(node.open)}..*` : `*..${_print(node.close!)}`;
				case NodeType.QualifiedValue:
					// aaa:bbb
					return `${node.not ? '-' : ''}${node.qualifier.value}:${_print(node.value)}`;
				case NodeType.Query:
					// aaa bbb ccc
					// note: ignores `sortby`-part
					let result = '';
					let lastEnd = -1;
					for (let child of node.nodes) {
						let value = _print(child);
						if (value) {
							result += lastEnd !== -1 && child.start !== lastEnd ? ' ' : '';
							result += value;
						}
						lastEnd = child.end;
					}
					return result;
				default:
					return '???';
			}
		}
		return _print(node);
	}

	export function getTypeOfNode(node: Node, symbols: SymbolTable): ValueType | undefined {
		switch (node._type) {
			case NodeType.VariableName:
				return symbols.getFirst(node.value)?.type;
			case NodeType.Date:
				return ValueType.Date;
			case NodeType.Number:
				return ValueType.Number;
			case NodeType.Literal:
				return ValueType.Literal;
			case NodeType.Compare:
				return getTypeOfNode(node.value, symbols);
			case NodeType.Range:
				if (node.open) {
					return getTypeOfNode(node.open, symbols);
				} else if (node.close) {
					return getTypeOfNode(node.close, symbols);
				}
		}
		return undefined;
	}
}
