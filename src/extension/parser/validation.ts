/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";
import { Node, NodeType, QualifiedValueNode, QueryDocumentNode, QueryNode, RangeNode, SimpleNode, Utils, VariableDefinitionNode } from "./nodes";
import { TokenType } from "./scanner";
import { QualifiedValueNodeSchema, RepeatInfo, SymbolTable, ValueType } from "./symbols";

export const enum Code {
	NodeMissing = 'NodeMissing',
	OrNotAllowed = 'OrNotAllowed',
	VariableDefinedRecursive = 'VariableDefinedRecursive',
	VariableUnknown = 'VariableUnknown',
	ValueConflict = 'ValueConflict',
	ValueUnknown = 'ValueUnknown',
	QualifierUnknown = 'QualifierUnknown',
	RangeMixesTypes = 'RangeMixesTypes',

	GitHubLoginNeeded = 'GitHubLoginNeeded'
}

export class ValidationError {
	constructor(readonly node: Node, readonly code: Code, readonly message: string, readonly conflictNode?: Node, readonly hint?: boolean) { }
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
			bucket.push(new ValidationError(node, Code.OrNotAllowed, l10n.t('OR is not supported when defining a variable')));
		}
		if (node._type === NodeType.VariableName && node.value === defNode.name.value) {
			bucket.push(new ValidationError(node, Code.VariableDefinedRecursive, l10n.t('Cannot reference a variable from its definition')));
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
				bucket.push(new ValidationError(node, Code.VariableUnknown, l10n.t('Unknown variable')));
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
		bucket.push(new ValidationError(node.qualifier, Code.QualifierUnknown, l10n.t("Unknown qualifier: '{0}'", node.qualifier.value)));
		return;
	}

	if (info.repeatable === RepeatInfo.No || !node.not && info.repeatable === RepeatInfo.RepeatNegated) {
		const key = `${node.not ? '-' : ''}${node.qualifier.value}`;
		if (conflicts.has(key)) {
			bucket.push(new ValidationError(node, Code.ValueConflict, l10n.t('This qualifier is already used'), conflicts.get(key)));
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
			bucket.push(new ValidationError(valueNode, Code.NodeMissing, valueNode.message, undefined, true));
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
			bucket.push(new ValidationError(valueNode, Code.ValueUnknown, l10n.t("Unknown value '{0}', expected type '{1}'", value, info.type)));
			return;
		}

		if (info.enumValues && info.placeholderType === undefined) {
			let set = value && info.enumValues.find(set => set.entries.has(value!) ? set : undefined);
			if (!set) {
				// value not known
				bucket.push(new ValidationError(valueNode, Code.ValueUnknown, l10n.t("Unknown value '{0}', expected one of: {1}", value, info.enumValues.map(set => [...set.entries].join(', ')).join(', '))));
			} else if (conflicts.has(set) && set.exclusive) {
				// other value from set in use
				bucket.push(new ValidationError(node, Code.ValueConflict, l10n.t('This value conflicts with another value.'), conflicts.get(set)));
			} else {
				conflicts.set(set, node);
			}
		}
	};

	if (node.value._type === NodeType.LiteralSequence) {
		if (!info.valueSequence) {
			bucket.push(new ValidationError(node.value, Code.OrNotAllowed, l10n.t('Sequence of values is not allowed')));
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
			bucket.push(new ValidationError(node, Code.RangeMixesTypes, l10n.t('This range uses mixed values: {0} and {1}', typeOpen, typeClose)));
		}
	}
}
