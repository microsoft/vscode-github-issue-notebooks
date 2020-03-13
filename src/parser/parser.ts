/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryNode, Node, NodeType, AnyNode, LiteralNode, NumberNode, DateNode, CompareNode, RangeNode, QualifiedValueNode, VariableNameNode, VariableDefinitionNode, MissingNode, OrExpressionNode, QueryDocumentNode } from "./nodes";
import { Scanner, Token, TokenType } from "./scanner";

export class Parser {

    private _scanner: Scanner = new Scanner();
    private _token: Token = { type: TokenType.EOF, start: 0, end: 0 };

    private _accept<T extends TokenType>(type: T): Token & { type: T; } | undefined {
        if (this._token?.type === type) {
            const value = this._token;
            this._token = this._scanner.next();
            return <Token & { type: T; }>value;
        }
    }

    private _reset(token?: Token): void {
        this._scanner.resetPosition(token);
        this._token = this._scanner.next();
    }

    parse(value: string): QueryDocumentNode {
        const nodes: Node[] = [];
        this._scanner.reset(value);
        this._token = this._scanner.next();
        while (this._token.type !== TokenType.EOF) {
            const node = this._parseVariableDefinition() ?? this._parseQuery();
            if (node) {
                nodes.push(node);
            }
            this._accept(TokenType.NewLine);
        }
        return this._createContainerNode(nodes, NodeType.QueryDocument);
    }

    private _parseQuery(): QueryNode | OrExpressionNode | undefined {
        let nodes: Node[] = [];
        while (this._token.type !== TokenType.NewLine && this._token.type !== TokenType.EOF) {

            // skip over whitespace
            if (this._accept(TokenType.Whitespace)) {
                continue;
            }

            // check for OR
            const tk = this._accept(TokenType.OR);
            if (tk && nodes.length > 0) {
                // make this a OrExpressionNode
                // todo@jrieken turn this into a query when there no right-side
                const left = this._createContainerNode(nodes, NodeType.Query);
                const right = this._parseQuery();
                return {
                    _type: NodeType.OrExpression,
                    start: left.start,
                    end: right?.end || tk.end,
                    left,
                    right
                };
            }

            // parse the query AS-IS
            const node = this._parseQualifiedValue()
                ?? this._parseNumber()
                ?? this._parseVariableName()
                ?? this._parseLiteral()
                ?? this._parseAny(this._token.type);

            if (!node) {
                throw new Error('no node produced...');
            }
            nodes.push(node);
        }

        return nodes.length > 0
            ? this._createContainerNode(nodes, NodeType.Query)
            : undefined;
    }

    private _parseAny(type: TokenType): AnyNode | undefined {
        const token = this._accept(type);
        if (token) {
            return {
                _type: NodeType.Any,
                start: token.start,
                end: token.end,
                tokenType: token.type
            };
        }
    }

    private _parseLiteral(): LiteralNode | undefined {
        const token = this._accept(TokenType.Literal) || this._accept(TokenType.QuotedLiteral);
        if (!token) {
            return undefined;
        };
        return {
            _type: NodeType.Literal,
            start: token.start,
            end: token.end,
            value: this._scanner.value(token)
        };
    }

    private _parseNumber(): NumberNode | undefined {
        const tk = this._accept(TokenType.Number);
        if (!tk) {
            return undefined;
        };
        return {
            _type: NodeType.Number,
            start: tk.start,
            end: tk.end,
            value: Number(this._scanner.value(tk))
        };
    }

    private _parseDate(): DateNode | undefined {
        const tk = this._accept(TokenType.Date) || this._accept(TokenType.DateTime);
        if (!tk) {
            return undefined;
        };
        return {
            _type: NodeType.Date,
            start: tk.start,
            end: tk.end,
            value: this._scanner.value(tk)
        };
    }

    private _parseCompare(): CompareNode | undefined {
        // <value
        // <=value
        // >value
        // >=value
        const cmp = this._accept(TokenType.LessThan)
            ?? this._accept(TokenType.LessThanEqual)
            ?? this._accept(TokenType.GreaterThan)
            ?? this._accept(TokenType.GreaterThanEqual);

        if (!cmp) {
            return;
        }
        const value = this._parseDate()
            ?? this._parseNumber()
            ?? this._createMissing('expected date or number');
        return {
            _type: NodeType.Compare,
            start: cmp.start,
            end: value.end,
            cmp: cmp.type,
            value: value
        };
    }

    private _parseRange(): RangeNode | undefined {
        // value..value
        const anchor = this._token;
        const open = this._parseDate() ?? this._parseNumber();
        if (!open) {
            return;
        }
        if (!this._accept(TokenType.Range)) {
            this._reset(anchor);
            return;
        }
        const close = this._parseDate() ?? this._parseNumber() ?? this._createMissing('expected number or date');
        return {
            _type: NodeType.Range,
            start: open.start,
            end: close.end,
            open,
            close
        };
    }

    private _parseRangeFixedEnd(): RangeNode | undefined {
        // *..value
        const tk = this._accept(TokenType.RangeFixedEnd);
        if (!tk) {
            return;
        }
        const close = this._parseDate() ?? this._parseNumber() ?? this._createMissing('expected number or date');
        return {
            _type: NodeType.Range,
            start: tk.start,
            end: close.end,
            open: undefined,
            close
        };
    }

    private _parseRangeFixedStart(): RangeNode | DateNode | NumberNode | undefined {
        // value..*
        const value = this._parseDate() ?? this._parseNumber();
        if (!value) {
            return;
        }
        const token = this._accept(TokenType.RangeFixedStart);
        if (!token) {
            return value;
        }
        return {
            _type: NodeType.Range,
            start: value.start,
            end: token.end,
            open: value,
            close: undefined
        };
    }

    private _parseQualifiedValue(): QualifiedValueNode | undefined {
        // literal:value
        // -literal:value
        const anchor = this._token;
        const not = this._accept(TokenType.Dash);
        const qualifier = this._parseLiteral();
        if (!qualifier || !this._accept(TokenType.Colon)) {
            this._reset(anchor);
            return;
        }

        const value = this._parseCompare()
            ?? this._parseRange()
            ?? this._parseRangeFixedStart()
            ?? this._parseRangeFixedEnd()
            ?? this._parseDate()
            ?? this._parseNumber()
            ?? this._parseVariableName()
            ?? this._parseLiteral()
            ?? this._parseAny(TokenType.SHA)
            ?? this._createMissing('expected value');

        return {
            _type: NodeType.QualifiedValue,
            start: not?.start ?? qualifier.start,
            end: value.end,
            not: Boolean(not),
            qualifier,
            value
        };
    }

    private _parseVariableName(): VariableNameNode | undefined {
        // ${name}
        const token = this._accept(TokenType.VariableName);
        if (!token) {
            return undefined;
        };
        return {
            _type: NodeType.VariableName,
            start: token.start,
            end: token.end,
            value: this._scanner.value(token)
        };
    }

    private _parseVariableDefinition(): VariableDefinitionNode | undefined {
        // ${name}=query
        const anchor = this._token;
        const name = this._parseVariableName();
        if (!name) {
            return;
        }
        if (!this._accept(TokenType.Equals)) {
            this._reset(anchor);
            return;
        }
        const value = this._parseQuery() ?? this._createMissing('query expected');
        return {
            _type: NodeType.VariableDefinition,
            start: name.start,
            end: value.end,
            name,
            value,
        };
    }

    private _createMissing(message: string): MissingNode {
        return {
            _type: NodeType.Missing,
            start: this._token!.start,
            end: this._token!.start,
            message
        };
    }

    private _createContainerNode(nodes: Node[], type: NodeType.Query): QueryNode;
    private _createContainerNode(nodes: Node[], type: NodeType.QueryDocument): QueryDocumentNode;
    private _createContainerNode(nodes: Node[], type: NodeType) {
        return {
            _type: type,
            start: nodes[0]?.start ?? 0,
            end: nodes[nodes.length - 1]?.end ?? 0,
            nodes
        };
    }
}
