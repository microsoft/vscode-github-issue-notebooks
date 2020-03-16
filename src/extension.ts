/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, NodeType } from './parser/nodes';
import { Utils } from "./parser/nodes";
import { validateQueryDocument } from './parser/validation';
import { ValueType, SymbolKind } from './parser/symbols';
import { QueryDocumentProject } from './service';

export function activate(context: vscode.ExtensionContext) {

	const selector = { language: 'github-issues' };

	// manage syntax trees
	const project = new QueryDocumentProject();
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => project.delete(doc)));

	// Hover (debug)
	context.subscriptions.push(vscode.languages.registerHoverProvider(selector, new class implements vscode.HoverProvider {
		async provideHover(document: vscode.TextDocument, position: vscode.Position) {
			const offset = document.offsetAt(position);
			const query = project.getOrCreate(document);
			const stack: Node[] = [];
			Utils.nodeAt(query, offset, stack);
			stack.shift();

			return new vscode.Hover(
				(await Promise.all(stack.map(async node => `- \`${await project.textOf(node)}\` (*${node._type}*)\n`))).join(''),
				await project.rangeOf(stack[stack.length - 1])
			);
		}
	}));

	// Smart Select
	context.subscriptions.push(vscode.languages.registerSelectionRangeProvider(selector, new class implements vscode.SelectionRangeProvider {
		async provideSelectionRanges(document: vscode.TextDocument, positions: vscode.Position[]) {
			const result: vscode.SelectionRange[] = [];
			const query = project.getOrCreate(document);
			for (let position of positions) {
				const offset = document.offsetAt(position);
				const parents: Node[] = [];
				if (Utils.nodeAt(query, offset, parents)) {
					let last: vscode.SelectionRange | undefined;
					for (let node of parents) {
						let selRange = new vscode.SelectionRange(await project.rangeOf(node), last);
						last = selRange;
					}
					if (last) {
						result.push(last);
					}
				}
			}
			return result;
		}
	}));

	// Completions
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, new class implements vscode.CompletionItemProvider {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const parents: Node[] = [];
			const node = Utils.nodeAt(query, offset, parents);
			const parent = parents[parents.length - 2];

			const result: vscode.CompletionItem[] = [];
			if (node === query || node?._type === NodeType.Literal) {
				// globals
				// todo@jrieken values..
				for (let symbol of project.symbols.all()) {
					result.push(new vscode.CompletionItem(symbol.name, symbol.kind === SymbolKind.Static ? vscode.CompletionItemKind.Constant : vscode.CompletionItemKind.Variable));
				}

			} else if (node?._type === NodeType.Missing && parent?._type === NodeType.QualifiedValue) {
				// complete a qualified expression
				const symbol = project.symbols.get(parent.qualifier.value);
				if (symbol?.kind === SymbolKind.Static && Array.isArray(symbol.value)) {
					for (let set of symbol.value) {
						for (let value of set) {
							result.push(new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
						}
					}
				}
			}
			return result;
		}
	}, ':'));

	// Definition
	context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, new class implements vscode.DefinitionProvider {
		async provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const node = Utils.nodeAt(query, offset);
			if (node?._type !== NodeType.VariableName) {
				return;
			}
			const result: vscode.Location[] = [];
			for (const symbol of project.symbols.getAll(node.value)) {
				if (symbol.kind === SymbolKind.User) {
					result.push(new vscode.Location(symbol.uri, await project.rangeOf(symbol.def, symbol.uri)));
				}
			}
			return result;
		}
	}));

	// References
	context.subscriptions.push(vscode.languages.registerReferenceProvider(selector, new class implements vscode.ReferenceProvider {
		provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext): vscode.ProviderResult<vscode.Location[]> {
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const node = Utils.nodeAt(query, offset);
			if (node?._type !== NodeType.VariableName) {
				return;
			}

			let result: Promise<vscode.Location>[] = [];
			for (let { node, uri } of project.all()) {
				Utils.walk(node, (node, parent) => {
					if (node._type === NodeType.VariableName && node.value === node.value) {
						if (context.includeDeclaration || parent?._type !== NodeType.VariableDefinition) {
							result.push(project.rangeOf(node, uri).then(range => new vscode.Location(uri, range)));
						}
					}
				});
			}
			return Promise.all(result);

		}
	}));

	// Validation
	const diagnostcis = vscode.languages.createDiagnosticCollection();
	async function validateDoc(doc: vscode.TextDocument) {
		if (vscode.languages.match(selector, doc)) {
			const query = project.getOrCreate(doc);
			const errors = validateQueryDocument(query, project.symbols);
			const diag = [...errors].map(async error => {
				const result = new vscode.Diagnostic(await project.rangeOf(error.node), error.message);
				if (error.conflictNode) {
					result.relatedInformation = [new vscode.DiagnosticRelatedInformation(
						new vscode.Location(doc.uri, await project.rangeOf(error.conflictNode)),
						await project.textOf(error.conflictNode)
					)];
				}
				return result;
			});
			diagnostcis.set(doc.uri, await Promise.all(diag));
		}
	}
	vscode.workspace.textDocuments.forEach(validateDoc);
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => diagnostcis.set(doc.uri, undefined)));
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(doc => validateDoc(doc)));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => validateDoc(e.document)));
}

