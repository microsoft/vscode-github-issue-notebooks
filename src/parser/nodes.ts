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

export interface QueryNode extends BaseNode {
    _type: NodeType.Query;
    nodes: Node[];
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
    cmp: TokenType.LessThan | TokenType.LessThanEqual | TokenType.GreaterThan | TokenType.GreaterThanEqual | undefined;
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
    value: Node;
}

export interface VariableNameNode extends BaseNode {
    _type: NodeType.VariableName;
    value: string;
}

export interface VariableDefinitionNode extends BaseNode {
    _type: NodeType.VariableDefinition;
    name: VariableNameNode;
    value: Node | MissingNode;
}

export interface OrExpressionNode extends BaseNode {
    _type: NodeType.OrExpression;
    left: Node;
    right: Node | undefined;
}

export interface QueryDocumentNode extends BaseNode {
    _type: NodeType.QueryDocument;
    nodes: Node[];
}

export type Node = QueryDocumentNode | QueryNode | OrExpressionNode | VariableDefinitionNode | VariableNameNode
    | QualifiedValueNode | RangeNode | CompareNode | DateNode | NumberNode | LiteralNode | MissingNode | AnyNode;


export interface NodeVisitor {
    (node: Node, parent: Node | undefined): any;
}

export namespace Utils {

    export function visit(node: Node, callback: NodeVisitor) {
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
        Utils.visit(node, node => {
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
}
