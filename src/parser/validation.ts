/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NodeType, Node, QueryNode, QueryDocumentNode, VariableDefinitionNode, Utils, QualifiedValueNode, RangeNode } from "./nodes";
import { ValueType, SymbolTable, SortByNodeSchema, QualifiedValueNodeSchema } from "./symbols";
import { TokenType } from "./scanner";

export const enum Code {
	NodeMissing = 'NodeMissing',
	OrNotAllowed = 'OrNotAllowed',
	VariableDefinedRecursive = 'VariableDefinedRecursive',
	VariableUnknown = 'VariableUnknown',
	ValueConflict = 'ValueConflict',
	ValueUnknown = 'ValueUnknown',
	QualifierUnknown = 'QualifierUnknown',
	RangeMixesTypes = 'RangeMixesTypes',
}

export class ValidationError {
	constructor(readonly node: Node, readonly code: Code, readonly message: string, readonly conflictNode?: Node) { }
}

export function validateQueryDocument(doc: QueryDocumentNode, symbols: SymbolTable): Iterable<ValidationError> {
	const result: ValidationError[] = [];
	Utils.walk(doc, node => {
		switch (node._type) {
			case NodeType.VariableDefinition:
				_validateVariableDefinition(node, result);
				break;
			case NodeType.Query:
				_validateQuery(node, result, symbols);
				break;
		}
	});
	return result;
}

function _validateVariableDefinition(defNode: VariableDefinitionNode, bucket: ValidationError[]) {

	if (defNode.value._type === NodeType.Missing) {
		bucket.push(new ValidationError(defNode, Code.NodeMissing, defNode.value.message));
		return;
	}

	// var-decl: no OR-statement 
	Utils.walk(defNode.value, node => {
		if (node._type === NodeType.Any && node.tokenType === TokenType.OR) {
			bucket.push(new ValidationError(node, Code.OrNotAllowed, `OR is not supported when defining a variable`));
		}
		if (node._type === NodeType.VariableName && node.value === defNode.name.value) {
			bucket.push(new ValidationError(node, Code.VariableDefinedRecursive, `Cannot reference a variable from its definition`));
		}
	});
}

function _validateQuery(query: QueryNode, bucket: ValidationError[], symbols: SymbolTable): void {

	const mutual = new Map<Set<string>, Node>();

	// validate children
	for (let node of query.nodes) {

		if (node._type === NodeType.QualifiedValue) {
			_validateQualifiedValue(node, bucket, symbols, mutual);

		} else if (node._type === NodeType.VariableName) {
			// variable-name => must exist
			const info = symbols.getFirst(node.value);
			if (!info) {
				bucket.push(new ValidationError(node, Code.VariableUnknown, `Unknown variable`));
			}
		}
	}

	// sortby
	if (query.sortby) {
		if (query.sortby.criteria._type === NodeType.Literal && !SortByNodeSchema.has(query.sortby.criteria.value)) {
			bucket.push(new ValidationError(query.sortby.criteria, Code.ValueUnknown, `Unknown value, must be one of: ${[...SortByNodeSchema].join(', ')}`));
		}
	}
}

function _validateQualifiedValue(node: QualifiedValueNode, bucket: ValidationError[], symbols: SymbolTable, mutualSets: Map<Set<string>, Node>): void {

	// check name first
	const info = QualifiedValueNodeSchema.get(node.qualifier.value);
	if (!info) {
		bucket.push(new ValidationError(node.qualifier, Code.QualifierUnknown, `Unknown qualifier: '${node.qualifier.value}'`));
		return;
	}

	if (node.value._type === NodeType.Range) {
		_validateRange(node.value, bucket, symbols);
	}

	// check value
	// get the 'actual' value
	let valueNode = node.value;
	if (valueNode._type === NodeType.Compare) {
		valueNode = valueNode.value;
	} else if (valueNode._type === NodeType.Range) {
		valueNode = valueNode.open || valueNode.close || valueNode;
	}

	// missing => done
	if (valueNode._type === NodeType.Missing) {
		bucket.push(new ValidationError(valueNode, Code.NodeMissing, valueNode.message));
		return;
	}

	// variable => get type/value
	let valueType: ValueType | undefined;
	let value: string | undefined;
	if (valueNode._type === NodeType.VariableName) {
		// variable value type
		const symbol = symbols.getFirst(valueNode.value);
		valueType = symbol?.type;
		value = symbol?.value;
	} else if (valueNode._type === NodeType.Date) {
		// literal
		valueType = ValueType.Date;
		value = valueNode.value;
	} else if (valueNode._type === NodeType.Number) {
		// literal
		valueType = ValueType.Number;
		value = String(valueNode.value);
	} else if (valueNode._type === NodeType.Literal) {
		// literal
		value = valueNode.value;
		valueType = ValueType.Literal;
	}

	if (info.type !== valueType) {
		bucket.push(new ValidationError(node.value, Code.ValueUnknown, `Unknown value '${value}', expected type '${info.type}'`));
		return;
	}

	if (info.enumValues) {
		let set = value && info.enumValues.find(set => set.has(value!) ? set : undefined);
		if (!set) {
			// value not known
			bucket.push(new ValidationError(node.value, Code.ValueUnknown, `Unknown value '${value}', expected one of: ${info.enumValues.map(set => [...set].join(', ')).join(', ')}`));
		} else if (mutualSets.has(set)) {
			// other value from set in use
			bucket.push(new ValidationError(node, Code.ValueConflict, `This value conflicts with another value.`, mutualSets.get(set)));
		} else {
			mutualSets.set(set, node);
		}
	}
}

function _validateRange(node: RangeNode, bucket: ValidationError[], symbol: SymbolTable) {
	// ensure both ends are of equal types
	if (node.open && node.close) {
		const typeOpen = Utils.getTypeOfNode(node.open, symbol);
		const typeClose = Utils.getTypeOfNode(node.close, symbol);
		if (typeOpen !== typeClose) {
			bucket.push(new ValidationError(node, Code.RangeMixesTypes, `This range uses mixed values: ${typeOpen} and ${typeClose}`));
		}
	}
}
