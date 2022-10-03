/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AnyNode, CompareNode, DateNode, LiteralNode, LiteralSequenceNode, MissingNode, NodeType, NumberNode, OrExpressionNode, QualifiedValueNode, QueryDocumentNode, QueryNode, RangeNode, VariableDefinitionNode, VariableNameNode } from "./nodes";
import { Scanner, Token, TokenType } from "./scanner";

export class Parser {

	private _scanner: Scanner = new Scanner();
	private _token: Token = { type: TokenType.EOF, start: 0, end: 0 };

	private _accept<T extends TokenType>(type: T): Token & { type: T; } | undefined {
		if (this._token.type === TokenType.EOF) {
			return undefined;
		}
		if (this._token.type === type) {
			const value = this._token;
			this._token = this._scanner.next();
			return <Token & { type: T; }>value;
		}
	}

	private _reset(token?: Token): void {
		this._scanner.resetPosition(token);
		this._token = this._scanner.next();
	}

	parse(value: string, id: string = Date.now().toString()): QueryDocumentNode {
		const nodes: (VariableDefinitionNode | OrExpressionNode | QueryNode)[] = [];
		this._scanner.reset(value);
		this._token = this._scanner.next();
		while (this._token.type !== TokenType.EOF) {
			// skip over whitespace
			if (this._accept(TokenType.Whitespace) || this._accept(TokenType.NewLine)) {
				continue;
			}
			const node = this._parseVariableDefinition() ?? this._parseQuery(true);
			if (node) {
				nodes.push(node);
			}
		}
		return {
			_type: NodeType.QueryDocument,
			start: 0,
			end: value.length,
			nodes,
			text: value,
			id
		};
	}

	private _parseQuery(allowOR: boolean): QueryNode | OrExpressionNode | undefined;
	private _parseQuery(allowOR: false): QueryNode | undefined;
	private _parseQuery(allowOR: boolean): QueryNode | OrExpressionNode | undefined {

		const start = this._token.start;
		const nodes: (QualifiedValueNode | NumberNode | DateNode | VariableNameNode | LiteralNode | AnyNode)[] = [];
		while (this._token.type !== TokenType.NewLine && this._token.type !== TokenType.EOF) {

			// skip over whitespace
			if (this._accept(TokenType.Whitespace) || this._accept(TokenType.LineComment)) {
				continue;
			}

			// check for OR
			const orTkn = allowOR && nodes.length > 0 && this._accept(TokenType.OR);
			if (orTkn) {
				// make this a OrExpressionNode
				const anchor = this._token;
				const right = this._parseQuery(allowOR);

				if (right) {
					const left: QueryNode = {
						_type: NodeType.Query,
						start,
						end: nodes[nodes.length - 1].end,
						nodes,
					};
					return {
						_type: NodeType.OrExpression,
						or: orTkn,
						start: left.start,
						end: right?.end || orTkn.end,
						left,
						right
					};
				}

				this._reset(anchor);
				nodes.push({
					_type: NodeType.Any,
					tokenType: orTkn.type,
					start: orTkn.start,
					end: orTkn.end
				});
			}

			// parse the query AS-IS
			const node = this._parseQualifiedValue()
				?? this._parseNumber()
				?? this._parseDate()
				?? this._parseVariableName()
				?? this._parseLiteral()
				?? this._parseAny(this._token.type);

			if (!node) {
				continue;
			}

			nodes.push(node);
		}

		if (nodes.length === 0) {
			return undefined;
		}

		return {
			_type: NodeType.Query,
			start,
			end: nodes[nodes.length - 1].end,
			nodes,
		};
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

	private _parseLiteralOrLiteralSequence(): LiteralNode | LiteralSequenceNode | undefined {
		const literal = this._parseLiteral();
		if (!literal) {
			return literal;
		}

		let comma = this._accept(TokenType.Comma);
		if (!comma) {
			return literal;
		}

		const nodes = [literal];
		do {
			const next = this._parseLiteral();
			if (!next) {
				break;
			}
			nodes.push(next);
			comma = this._accept(TokenType.Comma);
		} while (comma);

		return {
			_type: NodeType.LiteralSequence,
			start: literal.start,
			end: nodes[nodes.length - 1].end,
			nodes
		};
	}

	private _parseLiteral(): LiteralNode | undefined {
		const token = this._accept(TokenType.Literal) || this._accept(TokenType.QuotedLiteral);
		if (!token) {
			return undefined;
		}
		return {
			_type: NodeType.Literal,
			start: token.start,
			end: token.end,
			value: this._scanner.value(token)
		};
	}

	private _parseNumberLiteral(): NumberNode | LiteralNode | undefined {
		let tk = this._accept(TokenType.Number);
		if (!tk) {
			return undefined;
		}

		let value = this._scanner.value(tk);
		let end = tk.end;
		while (this._token.type !== TokenType.Whitespace && this._token.type !== TokenType.EOF) {
			value += this._scanner.value(this._token);
			end = this._token.end;
			this._accept(this._token.type);
		}

		if (end === tk.end) {
			// didnt move forward
			return {
				_type: NodeType.Number,
				start: tk.start,
				end,
				value: Number(this._scanner.value(tk))
			};
		}

		return {
			_type: NodeType.Literal,
			start: tk.start,
			end,
			value
		};
	}

	private _parseNumber(): NumberNode | undefined {
		const tk = this._accept(TokenType.Number);
		if (!tk) {
			return undefined;
		}
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
		}
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
			?? this._parseVariableName()
			?? this._createMissing([NodeType.Number, NodeType.Date]);
		return {
			_type: NodeType.Compare,
			start: cmp.start,
			end: value.end,
			cmp: this._scanner.value(cmp),
			value
		};
	}

	private _parseRange(): RangeNode | undefined {
		// value..value
		const anchor = this._token;
		const open = this._parseDate()
			?? this._parseNumber()
			?? this._parseVariableName();
		if (!open) {
			return;
		}
		if (!this._accept(TokenType.Range)) {
			this._reset(anchor);
			return;
		}
		const close = this._parseDate()
			?? this._parseNumber()
			?? this._parseVariableName()
			?? this._createMissing([NodeType.Number, NodeType.Date]);

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
		const close = this._parseDate()
			?? this._parseNumber()
			?? this._parseVariableName()
			?? this._createMissing([NodeType.Number, NodeType.Date]);
		return {
			_type: NodeType.Range,
			start: tk.start,
			end: close.end,
			open: undefined,
			close
		};
	}

	private _parseRangeFixedStart(): RangeNode | undefined {
		// value..*
		const anchor = this._token;
		const value = this._parseDate() ?? this._parseNumber();
		if (!value) {
			return;
		}
		const token = this._accept(TokenType.RangeFixedStart);
		if (!token) {
			this._reset(anchor);
			return undefined;
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
			?? this._parseNumberLiteral()
			?? this._parseVariableName()
			?? this._parseLiteralOrLiteralSequence()
			?? this._parseAny(TokenType.SHA)
			?? this._createMissing([NodeType.Any], true);

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
		}
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
		this._accept(TokenType.Whitespace);
		if (!this._accept(TokenType.Equals)) {
			this._reset(anchor);
			return;
		}
		const value = this._parseQuery(false) ?? this._createMissing([NodeType.Query]);
		return {
			_type: NodeType.VariableDefinition,
			start: name.start,
			end: value.end,
			name,
			value,
		};
	}

	private _createMissing(expected: NodeType[], optional?: boolean): MissingNode {
		return {
			_type: NodeType.Missing,
			start: this._token!.start,
			end: this._token!.start,
			expected,
			optional
		};
	}
}
