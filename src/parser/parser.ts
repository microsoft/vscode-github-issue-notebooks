/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum TokenType {
    Literal,
    QuotedLiteral,
    Number,
    Date,
    DateTime,
    Dash,
    Colon,
    LessThan,
    LessThanEqual,
    GreaterThan,
    GreaterThanEqual,
    Not,
    RangeFixedStart,
    RangeFixedEnd,
    Range,
    SHA,
    Unknown,
    Whitespace,
    // Macro,
    EOF,
}

export interface Token {
    type: TokenType,
    start: number;
    end: number;
}

export class Scanner {

    private _rules = new Map<TokenType, RegExp>([
        [TokenType.Whitespace, /\s+/y],
        [TokenType.DateTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|\+\d{2}:\d{2})/y], //YYYY-MM-DDTHH:MM:SS+00:00 or YYYY-MM-DDTHH:MM:SSZ
        [TokenType.Date, /\d{4}-\d{2}-\d{2}/y], //YYYY-MM-DDD
        [TokenType.SHA, /[a-fA-F0-9]{7,40}/y],
        [TokenType.Number, /\d+/y],
        [TokenType.QuotedLiteral, /"[^"]+"/y],
        [TokenType.Colon, /:/y],
        [TokenType.Dash, /-/y],
        [TokenType.LessThanEqual, /<=/y],
        [TokenType.LessThan, /</y],
        [TokenType.GreaterThanEqual, />=/y],
        [TokenType.GreaterThan, />/y],
        [TokenType.Not, /NOT/y],
        [TokenType.RangeFixedStart, new RegExp("\\.\\.\\*", 'y')],
        [TokenType.RangeFixedEnd, new RegExp("\\*\\.\\.", 'y')],
        [TokenType.Range, new RegExp("\\.\\.", 'y')],
        // [TokenType.Macro, /\$\{[_a-z][_a-z0-9]+\}/i], // ${_foo}
        [TokenType.Literal, /[^\s:"]+/y],
        [TokenType.Unknown, /.+/y],
    ]);

    private _value: string;
    private _pos: number;

    constructor(value: string) {
        this._value = value;
        this._pos = 0;
    }

    next(): Token {
        if (this._pos < this._value.length) {
            let match: RegExpMatchArray | null;
            for (let [type, regexp] of this._rules) {
                regexp.lastIndex = this._pos;
                match = regexp.exec(this._value);
                if (match) {
                    const token: Token = {
                        type: type,
                        start: this._pos,
                        end: this._pos + match[0].length,
                    };
                    this._pos = token.end;
                    return token;
                }
            }
            // the scanner must always match something
            throw new Error(`BAD scanner state at ${this._pos} in ${this._value}`);
        }
        return { type: TokenType.EOF, start: this._value.length, end: this._value.length };
    }

    reset(token?: Token): void {
        if (token) {
            this._pos = token.start;
        }
    }

    value(token: Token): string {
        return this._value.substring(token.start, token.end);
    }

    *[Symbol.iterator](): Iterator<Token> {
        while (true) {
            let token = this.next();
            yield token;
            if (token?.type === TokenType.EOF) {
                break;
            }
        }
    }
}

export const enum NodeType {
    Literal = 'Literal',
    Number = 'Number',
    Date = 'Date',
    QualifiedValue = 'QualifiedValue',
    Range = 'Range',
    Compare = 'Compare',
    Any = 'Any',
    Missing = 'Missing',
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
    cmp: TokenType.LessThan | TokenType.LessThanEqual | TokenType.GreaterThan | TokenType.GreaterThanEqual | undefined;
    node: DateNode | NumberNode | MissingNode;
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

export type Node = QualifiedValueNode | RangeNode | CompareNode | DateNode | NumberNode | LiteralNode | MissingNode | AnyNode;

export interface NodeVisitor {
    (node: Node): any;
}

export class Query {

    constructor(readonly nodes: readonly Node[]) {

    }

    static containsPosition(node: Node, offset: number): boolean {
        return node.start <= offset && offset <= node.end;
    }

    nodeAt(offset: number): Node | undefined {
        for (let node of this.nodes) {
            let result: Node | undefined;
            Query.visit(node, node => {
                if (Query.containsPosition(node, offset)) {
                    result = node;
                }
            });
            if (result) {
                return result;
            }
        }
        return undefined;
    }

    visit(callback: NodeVisitor) {
        for (let node of this.nodes) {
            Query.visit(node, callback);
        }
    }

    static visit(node: Node, callback: NodeVisitor) {
        if (!node) {
            return;
        }
        let stack: Array<Node | undefined> = [node];
        while (stack.length > 0) {
            let node = stack.shift();
            if (!node) {
                continue;
            }
            callback(node);
            switch (node._type) {
                case NodeType.Compare:
                    stack.unshift(node.node);
                    break;
                case NodeType.Range:
                    stack.unshift(node.close);
                    stack.unshift(node.open);
                    break;
                case NodeType.QualifiedValue:
                    stack.unshift(node.value);
                    stack.unshift(node.qualifier);
                    break;
            }
        }
    }

}

export class Parser {

    private _scanner: Scanner = new Scanner('');
    private _token: Token = { type: TokenType.EOF, start: 0, end: 0 };

    private _accept<T extends TokenType>(type: T): Token & { type: T; } | undefined {
        if (this._token?.type === type) {
            const value = this._token;
            this._token = this._scanner.next();
            return <Token & { type: T; }>value;
        }
    }

    private _reset(token?: Token): void {
        this._scanner.reset(token);
        this._token = this._scanner.next();
    }

    parse(value: string): Query {
        let nodes: Node[] = [];
        this._scanner = new Scanner(value);
        this._token = this._scanner.next();
        while (this._token.type !== TokenType.EOF) {

            if (this._accept(TokenType.Whitespace)) {
                continue;
            }

            const node = this._parseQualifiedValue()
                ?? this._parseNumber()
                ?? this._parseLiteral()
                ?? this._parseAny(this._token.type);

            if (!node) {
                throw new Error('no node produced...');
            }

            nodes.push(node);
        }
        return new Query(nodes);
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
            node: value
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

    private _createMissing(message: string): MissingNode {
        return {
            _type: NodeType.Missing,
            start: this._token!.start,
            end: this._token!.start,
            message
        };
    }
}
