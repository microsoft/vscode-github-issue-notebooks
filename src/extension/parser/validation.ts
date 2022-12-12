/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LiteralNode, Node, NodeType, QualifiedValueNode, QueryDocumentNode, QueryNode, RangeNode, SimpleNode, Utils, VariableDefinitionNode } from "./nodes";
import { TokenType } from "./scanner";
import { QualifiedValueNodeSchema, RepeatInfo, SymbolTable, ValueSet, ValueType } from "./symbols";

export const enum Code {
	NodeMissing = 'NodeMissing',
	OrNotAllowed = 'OrNotAllowed',
	SequenceNotAllowed = 'SequenceNotAllowed',
	VariableDefinedRecursive = 'VariableDefinedRecursive',
	VariableUnknown = 'VariableUnknown',
	ValueConflict = 'ValueConflict',
	ValueUnknown = 'ValueUnknown',
	ValueTypeUnknown = 'ValueTypeUnknown',
	QualifierUnknown = 'QualifierUnknown',
	RangeMixesTypes = 'RangeMixesTypes',

	GitHubLoginNeeded = 'GitHubLoginNeeded'
}


export type ValidationError = GenericError | QualifierUnknownError | ValueConflictError | ValueUnknownError | ValueTypeError | MissingNodeError | MixedTypesError;

export interface GenericError {
	readonly code: Code.OrNotAllowed | Code.SequenceNotAllowed | Code.VariableDefinedRecursive | Code.VariableUnknown;
	readonly node: Node;
}

export interface ValueConflictError {
	readonly code: Code.ValueConflict;
	readonly node: Node;
	readonly conflictNode: Node;
}

export interface QualifierUnknownError {
	readonly code: Code.QualifierUnknown;
	readonly node: LiteralNode;
}

export interface ValueUnknownError {
	readonly code: Code.ValueUnknown;
	readonly node: Node;
	readonly actual: string;
	readonly expected: Iterable<ValueSet>;
}

export interface ValueTypeError {
	readonly code: Code.ValueTypeUnknown;
	readonly node: Node;
	readonly actual: string;
	readonly expected: ValueType;
}

export interface MissingNodeError {
	readonly code: Code.NodeMissing;
	readonly node: Node;
	readonly expected: NodeType[];
	readonly hint: boolean;
}

export interface MixedTypesError {
	readonly code: Code.RangeMixesTypes;
	readonly node: Node;
	readonly valueA: ValueType | undefined;
	readonly valueB: ValueType | undefined;
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
		bucket.push({ node: defNode, code: Code.NodeMissing, expected: defNode.value.expected, hint: false });
		return;
	}

	// var-decl: no OR-statement 
	Utils.walk(defNode.value, node => {
		if (node._type === NodeType.Any && node.tokenType === TokenType.OR) {
			bucket.push({ node, code: Code.OrNotAllowed });
		}
		if (node._type === NodeType.VariableName && node.value === defNode.name.value) {
			bucket.push({ node, code: Code.VariableDefinedRecursive });
		}
	});
}

function _validateQuery(query: QueryNode, bucket: ValidationError[], symbols: SymbolTable): void {

	const mutual = new Map<any, Node>();

	// validate children
	for (let node of query.nodes) {

		if (node._type === NodeType.QualifiedValue) {
			_validateQualifiedValue(node, bucket, symbols, mutual);

		} else if (node._type === NodeType.VariableName) {
			// variable-name => must exist
			const info = symbols.getFirst(node.value);
			if (!info) {
				bucket.push({ node, code: Code.VariableUnknown });
			}
		}
	}
}

function _validateQualifiedValue(node: QualifiedValueNode, bucket: ValidationError[], symbols: SymbolTable, conflicts: Map<any, Node>): void {

	// check name first
	const info = QualifiedValueNodeSchema.get(node.qualifier.value);
	if (!info && node.value._type === NodeType.Missing) {
		// skip -> likely not a key-value-expression
		return;
	}
	if (!info) {
		bucket.push({ node: node.qualifier, code: Code.QualifierUnknown });
		return;
	}

	if (info.repeatable === RepeatInfo.No || !node.not && info.repeatable === RepeatInfo.RepeatNegated) {
		const key = `${node.not ? '-' : ''}${node.qualifier.value}`;
		if (conflicts.has(key)) {
			bucket.push({ node, code: Code.ValueConflict, conflictNode: conflicts.get(key)! });
		} else {
			conflicts.set(key, node);
		}
	}

	if (node.value._type === NodeType.Range) {
		_validateRange(node.value, bucket, symbols);
	}

	// check value

	const validateValue = (valueNode: SimpleNode) => {

		// get the 'actual' value
		if (valueNode._type === NodeType.Compare) {
			valueNode = valueNode.value;
		} else if (valueNode._type === NodeType.Range) {
			valueNode = valueNode.open || valueNode.close || valueNode;
		}

		// missing => done
		if (info && valueNode._type === NodeType.Missing) {
			bucket.push({ node: valueNode, code: Code.NodeMissing, expected: valueNode.expected, hint: true });
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
			bucket.push({ node: valueNode, code: Code.ValueTypeUnknown, actual: value!, expected: info.type });
			return;
		}

		if (info.enumValues && info.placeholderType === undefined) {
			let set = value && info.enumValues.find(set => set.entries.has(value!) ? set : undefined);
			if (!set) {
				// value not known
				bucket.push({ node: valueNode, code: Code.ValueUnknown, actual: value!, expected: info.enumValues });
			} else if (conflicts.has(set) && set.exclusive) {
				// other value from set in use
				bucket.push({ node, code: Code.ValueConflict, conflictNode: conflicts.get(set)! });
			} else {
				conflicts.set(set, node);
			}
		}
	};

	if (node.value._type === NodeType.LiteralSequence) {
		if (!info.valueSequence) {
			bucket.push({ node: node.value, code: Code.SequenceNotAllowed });
		}
		node.value.nodes.forEach(validateValue);
	} else {
		validateValue(node.value);
	}
}

function _validateRange(node: RangeNode, bucket: ValidationError[], symbol: SymbolTable) {
	// ensure both ends are of equal types
	if (node.open && node.close) {
		const typeOpen = Utils.getTypeOfNode(node.open, symbol);
		const typeClose = Utils.getTypeOfNode(node.close, symbol);
		if (typeOpen !== typeClose) {
			bucket.push({ node, code: Code.RangeMixesTypes, valueA: typeOpen, valueB: typeClose });
		}
	}
}
