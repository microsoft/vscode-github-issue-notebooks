/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Query, NodeType, Node, QueryNode } from "./parser";
import { qualifiers, ValueType } from "./schema";


export class ValidationError {
    constructor(readonly node: Node, readonly message: string) { }
}

export function validateQuery(query: QueryNode): readonly ValidationError[] {
    let result: ValidationError[] = [];
    Query.visit(query, node => {
        // missing nodes
        if (node._type === NodeType.Missing) {
            result.push(new ValidationError(node, node.message));
        }
        // unbalanced range
        if (node._type === NodeType.Range) {
            if (node.open && node.close && node.open._type !== node.close._type) {
                result.push(new ValidationError(node, `Range must start and end with equals types`));
            }
        }
        // unknown qualifier
        // unknown qualifier-value
        if (node._type === NodeType.QualifiedValue) {
            const def = qualifiers.get(node.qualifier.value);
            if (def === undefined) {
                result.push(new ValidationError(node.qualifier, `Unknown qualifier: '${node.qualifier.value}'`));

            } else if (node.value._type !== NodeType.Missing) {

                if (def instanceof Set) {
                    if (node.value._type !== NodeType.Literal) {
                        result.push(new ValidationError(node.value, `Invalid value, expected literal`));
                    } else if (!def.has(node.value.value)) {
                        result.push(new ValidationError(node.value, `Unknown value, must be one of: ${[...def].join(', ')}`));
                    }

                } else if (Array.isArray(def)) {
                    if (node.value._type !== NodeType.Literal) {
                        result.push(new ValidationError(node.value, `Invalid value, expected literal`));
                    } else {
                        let value = node.value.value;
                        let found = def.some(set => set.has(value));
                        if (!found) {
                            result.push(new ValidationError(node.value, `Unknown value, must be one of: ${def.map(set => [...set].join(', ')).join(', ')}`));
                        }
                    }

                } else if (def === ValueType.Date && !isNumberOrDateLike(node.value, NodeType.Date)) {
                    result.push(new ValidationError(node.value, `Invalid value, expected date`));

                } else if (def === ValueType.Number && !isNumberOrDateLike(node.value, NodeType.Number)) {
                    result.push(new ValidationError(node.value, `Invalid value, expected number`));
                }
            }
        }
        // range from..to => from < to
        // qualifier with mutual exclusive values
    });

    return result;
}

function isNumberOrDateLike(node: Node, what: NodeType.Number | NodeType.Date): boolean {
    if (node._type === what) {
        return true;
    }
    if (node._type === NodeType.Compare && node.value._type === what) {
        return true;
    }
    if (node._type === NodeType.Range && node.open?._type === what) {
        return true;
    }
    return false;
}
