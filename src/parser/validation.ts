/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NodeType, Node, QueryNode, QueryDocumentNode, VariableDefinitionNode, Utils } from "./nodes";
import { ValueType, SymbolTable, SymbolKind } from "./symbols";
import { TokenType } from "./scanner";

export class ValidationError {
	constructor(readonly node: Node, readonly message: string, readonly conflictNode?: Node) { }
}

export function validateQueryDocument(doc: QueryDocumentNode, symbols: SymbolTable): Iterable<ValidationError> {
	const result: ValidationError[] = [];
	Utils.walk(doc, node => {
		switch (node._type) {
			case NodeType.Query:
				validateQuery(node, result, symbols);
				break;
			case NodeType.VariableDefinition:
				validateVariableDefinition(node, result);
				break;
		}
	});
	return result;
}

function validateQuery(query: QueryNode, bucket: ValidationError[], symbols: SymbolTable): void {

	let mutual = new Map<string, Node>();

	Utils.walk(query, node => {

		// unknown qualifier
		// unknown qualifier-value
		// qualifier with mutual exclusive values, e.g is:pr is:issue
		if (node._type === NodeType.QualifiedValue) {

			// check name
			const info = symbols.get(node.qualifier.value);
			if (!info || info.kind !== SymbolKind.Static) {
				bucket.push(new ValidationError(node.qualifier, `Unknown qualifier: '${node.qualifier.value}'`));
				return;
			}

			// check value
			if (node.value._type === NodeType.VariableName) {
				// trust all variables...
				return;
			}

			if (Array.isArray(info.value)) {
				const value = node.value._type === NodeType.Literal ? node.value.value : '';
				if (mutual.has(value)) {
					bucket.push(new ValidationError(node, `Conflicts with mutual exclusive expression`, mutual.get(value)));
					return;
				}

				let found = false;
				for (let set of info.value) {
					if (set.has(value)) {
						found = true;
						for (let candidate of set) {
							if (candidate !== value) {
								mutual.set(candidate, node);
							}
						}
					}
					if (found) {
						break;
					}
				}
				if (!found) {
					bucket.push(new ValidationError(node.value, `Unknown value, must be one of: ${info.value.map(set => [...set].join(', ')).join(', ')}`));
					return;
				}
			}

			if (info.value === ValueType.Date && !isNumberOrDateLike(node.value, NodeType.Date)) {
				bucket.push(new ValidationError(node.value, `Invalid value, expected date`));
				return;
			}

			if (info.value === ValueType.Number && !isNumberOrDateLike(node.value, NodeType.Number)) {
				bucket.push(new ValidationError(node.value, `Invalid value, expected number`));
				return;
			}
			// range from..to => from < to
		}

		if (node._type === NodeType.VariableName) {
			const info = symbols.get(node.value);
			if (!info || info.kind !== SymbolKind.User) {
				bucket.push(new ValidationError(node, `Unknown variable`));
				return;
			}
		}

		// unbalanced range
		if (node._type === NodeType.Range) {
			if (node.open && node.close && node.open._type !== node.close._type) {
				bucket.push(new ValidationError(node, `Range must start and end with equals types`));
				return;
			}
		}

		// missing nodes
		if (node._type === NodeType.Missing) {
			bucket.push(new ValidationError(node, node.message));
			return;
		}
		// todo@jrieken undefined variables
	});
}

function validateVariableDefinition(defNode: VariableDefinitionNode, bucket: ValidationError[]) {
	// var-decl: no OR-statement 
	Utils.walk(defNode.value, node => {
		if (node._type === NodeType.Any && node.tokenType === TokenType.OR) {
			bucket.push(new ValidationError(node, `OR is not supported when defining a variable`));
		}
		if (node._type === NodeType.VariableName && node.value === defNode.name.value) {
			bucket.push(new ValidationError(node, `Cannot reference a variable from its definition`));
		}
	});
}

function isNumberOrDateLike(node: Node, what: NodeType.Number | NodeType.Date): boolean {
	if (node._type === what) {
		return true;
	}
	if (node._type === NodeType.Compare && node.value._type === what) {
		return true;
	}
	if (node._type === NodeType.Range && (node.open?._type === what || node.close?._type === what)) {
		return true;
	}
	return false;
}
