/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TokenType } from "./scanner";

export const enum NodeType {
    Any = 'Any',
    Compare = 'Compare',
    Date = 'Date',
    Literal = 'Literal',
    Missing = 'Missing',
    Number = 'Number',
    OrExpression = 'BinaryExpression',
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
    message: string;
}

export interface LiteralNode extends BaseNode {
    _type: NodeType.Literal;
    value: string;
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
    value: DateNode | NumberNode | MissingNode;
}

export interface RangeNode extends BaseNode {
    _type: NodeType.Range,
    open: NumberNode | DateNode | undefined;
    close: NumberNode | DateNode | MissingNode | undefined;
}

export interface QualifiedValueNode extends BaseNode {
    _type: NodeType.QualifiedValue;
    not: boolean;
    qualifier: LiteralNode;
    value: SimpleNode;
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
    nodes: SimpleNode[];
}

export interface OrExpressionNode extends BaseNode {
    _type: NodeType.OrExpression;
    left: QueryNode;
    right: QueryNode | OrExpressionNode;
}

export interface QueryDocumentNode extends BaseNode {
    _type: NodeType.QueryDocument;
    nodes: (QueryNode | OrExpressionNode | VariableDefinitionNode)[];
}

export type SimpleNode = VariableNameNode | QualifiedValueNode | RangeNode | CompareNode | DateNode | NumberNode | LiteralNode | MissingNode | AnyNode;

export type Node = QueryDocumentNode // level 1
    | QueryNode | OrExpressionNode | VariableDefinitionNode // level 2
    | SimpleNode;


export interface NodeVisitor {
    (node: Node, parent: Node | undefined): any;
}

export namespace Utils {
    export function visit(node: Node, callback: NodeVisitor) {
        const cb = (node?: Node) => {
            if (node) {
                callback(node, undefined);
            }
        };
        cb(node);
        switch (node._type) {
            case NodeType.Compare:
                cb(node.value);
                break;
            case NodeType.Range:
                cb(node.open);
                cb(node.close);
                break;
            case NodeType.QualifiedValue:
                cb(node.qualifier);
                cb(node.value);
                break;
            case NodeType.VariableDefinition:
                cb(node.name);
                cb(node.value);
                break;
            case NodeType.OrExpression:
                cb(node.left);
                cb(node.right);
                break;
            case NodeType.QueryDocument:
            case NodeType.Query:
                node.nodes.forEach(cb);
                break;

        }
    }
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
                case NodeType.QueryDocument:
                case NodeType.Query:
                    for (let child of node.nodes.reverse()) {
                        stack.unshift(child);
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

    function _flatten<T>(...args: (T | T[])[]): T[] {
        let result: T[] = [];
        for (let arg of args) {
            if (!arg) {
                continue;
            }
            if (Array.isArray(arg)) {
                result = result.concat(arg);
            } else {
                result.push(arg);
            }
        }
        return result;
    }

    export function print(node: Node, ctx: { text: string, variableValues: Map<string, string>; }): string[] {
        const { text, variableValues } = ctx;

        function _print(node: Node): string | string[] {

            switch (node._type) {
                case NodeType.Missing:
                case NodeType.VariableDefinition:
                    // no value for those
                    return '';
                case NodeType.VariableName:
                    // look up variable (must be defined first)
                    return variableValues.get(node.value) || `${node.value}`;
                case NodeType.Any:
                case NodeType.Literal:
                case NodeType.Date:
                case NodeType.Number:
                    return text.substring(node.start, node.end);
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
                    return node.nodes.map(_print).join(' ');
                case NodeType.OrExpression:
                    // each OR-part becomes a separate query
                    return _flatten(_print(node.left), _print(node.right));
                case NodeType.QueryDocument:
                    return _flatten(...node.nodes.map(_print));

            }
        }

        return <string[]>_print(node);
    }
}
