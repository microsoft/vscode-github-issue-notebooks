/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryDocumentNode, Utils, NodeType, Node, QueryNode } from "./parser/nodes";
import { Project } from "./project";

export interface RepoInfo {
	owner: string;
	repo: string;
}

export function* getRepoInfos(doc: QueryDocumentNode, project: Project, node: QueryNode): Generator<RepoInfo> {

	const repoStrings: string[] = [];

	let stack: { node: Node, doc: QueryDocumentNode; }[] = [{ doc, node }];

	while (stack.length) {

		const { doc, node } = stack.shift()!;

		Utils.walk(node, (node, parent) => {

			if (node._type === NodeType.VariableName && parent?._type !== NodeType.VariableDefinition) {
				// check variables
				let symbol = project.symbols.getFirst(node.value);
				if (symbol) {
					stack.push({ node: symbol.def, doc: symbol.root });
				}

			} else if (node._type === NodeType.QualifiedValue && node.qualifier.value === 'repo') {
				// check repo-statement

				let value: string | undefined;
				if (node.value._type === NodeType.VariableName) {
					value = project.symbols.getFirst(node.value.value)?.value;
				} else {
					value = Utils.print(node.value, doc.text, () => undefined);
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
