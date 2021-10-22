/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Node, NodeType, QueryDocumentNode, Utils } from "./parser/nodes";
import { QualifiedValueNodeSchema, ValuePlaceholderType } from "./parser/symbols";
import { Project } from "./project";

export interface RepoInfo {
	owner: string;
	repo: string;
}

export function* getAllRepos(project: Project): Generator<RepoInfo> {

	const repoStrings: string[] = [];

	for (let item of project.all()) {

		Utils.walk(item.node, node => {
			// check repo-statement
			if (node._type === NodeType.QualifiedValue && node.qualifier.value === 'repo') {

				let value: string | undefined;
				if (node.value._type === NodeType.VariableName) {
					// repo:$SOME_VAR
					value = project.symbols.getFirst(node.value.value)?.value;
				} else {
					// repo:some_value
					value = Utils.print(node.value, item.doc.getText(), () => undefined);
				}

				if (value) {
					repoStrings.push(value);
				}
			}
		});
	}

	for (let string of repoStrings) {
		let idx = string.indexOf('/');
		if (idx > 0) {
			const owner = string.substring(0, idx);
			const repo = string.substring(idx + 1);
			yield { owner, repo };
		}
	}
}

export function isRunnable(query: QueryDocumentNode): boolean {
	return query.nodes.some(node => node._type === NodeType.Query || node._type === NodeType.OrExpression);
}

export function isUsingAtMe(query: Node, project: Project): number {
	let result = 0;
	Utils.walk(query, (node, parent) => {
		if (result === 0) {
			if (node._type === NodeType.VariableName && parent?._type !== NodeType.VariableDefinition) {
				// check variables
				let symbol = project.symbols.getFirst(node.value);
				if (symbol) {
					result += 2 * isUsingAtMe(symbol.def, project);
				}

			} else if (node._type === NodeType.QualifiedValue && node.value._type === NodeType.Literal && node.value.value === '@me') {
				const info = QualifiedValueNodeSchema.get(node.qualifier.value);
				if (info?.placeholderType === ValuePlaceholderType.Username) {
					result = 1;
				}
			}
		}
	});
	return result;
}
