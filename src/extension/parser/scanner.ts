/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum TokenType {
	Literal = 'Literal',
	QuotedLiteral = 'QuotedLiteral',
	Number = 'Number',
	Date = 'Date',
	DateTime = 'DateTime',
	Dash = 'Dash',
	Colon = 'Colon',
	Comma = 'Comma',
	LessThan = 'LessThan',
	LessThanEqual = 'LessThanEqual',
	GreaterThan = 'GreaterThan',
	GreaterThanEqual = 'GreaterThanEqual',
	Not = 'Not',
	RangeFixedStart = 'RangeFixedStart',
	RangeFixedEnd = 'RangeFixedEnd',
	Range = 'Range',
	SHA = 'SHA',
	Unknown = 'Unknown',
	Whitespace = 'Whitespace',
	EOF = 'EOF',
	//not GH standard
	LineComment = 'LineComment',
	OR = 'OR',
	Equals = 'Equals',
	VariableName = 'VariableName',
	NewLine = 'NewLine'
}

export interface Token {
	type: TokenType;
	start: number;
	end: number;
}

export class Scanner {

	private _rules = new Map<TokenType, RegExp>([
		// the sorting here is important because some regular expression
		// are more relaxed than others and would "eat away too much" if 
		// they come early
		[TokenType.LineComment, /\/\/[^\r\n]*/y],
		[TokenType.NewLine, /\r\n|\n/y],
		[TokenType.Whitespace, /[ \t]+/y],
		[TokenType.DateTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|\+\d{2}:\d{2})\b/y],
		[TokenType.Date, /\d{4}-\d{2}-\d{2}\b/y],
		[TokenType.SHA, /[a-fA-F0-9]{7,40}\b/y],
		[TokenType.Number, /\d+\b/y],
		[TokenType.QuotedLiteral, /"[^"]+"/y],
		[TokenType.Colon, /:/y],
		[TokenType.Comma, /,/y],
		[TokenType.Dash, /-/y],
		[TokenType.Equals, /=/y],
		[TokenType.LessThanEqual, /<=/y],
		[TokenType.LessThan, /</y],
		[TokenType.GreaterThanEqual, />=/y],
		[TokenType.GreaterThan, />/y],
		[TokenType.Not, /\bNOT\b/y],
		[TokenType.OR, /\bOR\b/y],
		[TokenType.VariableName, /\$[_a-zA-Z][_a-zA-Z0-9]*/y],
		[TokenType.RangeFixedStart, new RegExp("\\.\\.\\*", 'y')],
		[TokenType.RangeFixedEnd, new RegExp("\\*\\.\\.", 'y')],
		[TokenType.Range, new RegExp("\\.\\.", 'y')],
		[TokenType.Literal, /[^\s:"=,]+/y],
		[TokenType.Unknown, /.+/y],
	]);

	private _value: string = '';
	private _pos: number = 0;

	get pos(): number {
		return this._pos;
	}

	reset(value: string) {
		this._value = value;
		this._pos = 0;
		return this;
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

	resetPosition(token?: Token): void {
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
