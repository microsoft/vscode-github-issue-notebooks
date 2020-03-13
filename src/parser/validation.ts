/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Query, NodeType, Node, QueryNode } from "./parser";
import { qualifiers, ValueType } from "./schema";


export class ValidationError {
    constructor(readonly node: Node, readonly message: string, readonly conflictNode?: Node) { }
}

export function validateQuery(query: QueryNode): Iterable<ValidationError> {

    let result = new Map<Node, ValidationError>();
    let mutual = new Map<string, Node>();

    Query.visit(query, node => {

        // unknown qualifier
        // unknown qualifier-value
        // qualifier with mutual exclusive values, e.g is:pr is:issue
        if (node._type === NodeType.QualifiedValue) {
            const def = qualifiers.get(node.qualifier.value);
            if (def === undefined) {
                result.set(node, new ValidationError(node.qualifier, `Unknown qualifier: '${node.qualifier.value}'`));
                return;
            }

            if (Array.isArray(def)) {
                const value = node.value._type === NodeType.Literal ? node.value.value : '';
                if (mutual.has(value)) {
                    result.set(node, new ValidationError(node, `Conflicts with mutual exclusive expression`, mutual.get(value)));
                    return;
                }

                let found = false;
                for (let set of def) {
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
                    result.set(node, new ValidationError(node.value, `Unknown value, must be one of: ${def.map(set => [...set].join(', ')).join(', ')}`));
                    return;
                }
            }

            if (def === ValueType.Date && !isNumberOrDateLike(node.value, NodeType.Date)) {
                result.set(node, new ValidationError(node.value, `Invalid value, expected date`));
                return;
            }

            if (def === ValueType.Number && !isNumberOrDateLike(node.value, NodeType.Number)) {
                result.set(node, new ValidationError(node.value, `Invalid value, expected number`));
                return;
            }
            // range from..to => from < to
        }

        // unbalanced range
        if (node._type === NodeType.Range) {
            if (node.open && node.close && node.open._type !== node.close._type) {
                result.set(node, new ValidationError(node, `Range must start and end with equals types`));
                return;
            }
        }

        // missing nodes
        if (node._type === NodeType.Missing) {
            result.set(node, new ValidationError(node, node.message));
            return;
        }

    });

    return result.values();
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
