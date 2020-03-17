/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, NodeType } from './parser/nodes';
import { Utils } from "./parser/nodes";
import { validateQueryDocument } from './parser/validation';
import { SymbolKind } from './parser/symbols';
import { QueryDocumentProject } from './service';
import { IssuesNotebookProvider } from './notebook';
import { Scanner, TokenType } from './parser/scanner';

export function activate(context: vscode.ExtensionContext) {

	const selector = { language: 'github-issues' };

	// manage syntax trees
	const project = new QueryDocumentProject();
	// context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => project.delete(doc)));


	// --- NOTEBOOK
	vscode.window.registerNotebookProvider('github-issues', new IssuesNotebookProvider(project));

	// --- LANGUAGE SMARTS

	vscode.languages.setLanguageConfiguration(selector.language, {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
		comments: { lineComment: '//' }
	});

	// // Hover (debug, ast)
	// context.subscriptions.push(vscode.languages.registerHoverProvider(selector, new class implements vscode.HoverProvider {
	// 	async provideHover(document: vscode.TextDocument, position: vscode.Position) {
	// 		const offset = document.offsetAt(position);
	// 		const query = project.getOrCreate(document);
	// 		const stack: Node[] = [];
	// 		Utils.nodeAt(query, offset, stack);
	// 		stack.shift();

	// 		return new vscode.Hover(
	// 			stack.map(node => `- \`${project.textOf(node)}\` (*${node._type}*)\n`).join(''),
	// 			project.rangeOf(stack[stack.length - 1])
	// 		);
	// 	}
	// }));

	// Hover
	context.subscriptions.push(vscode.languages.registerHoverProvider(selector, new class implements vscode.HoverProvider {
		async provideHover(document: vscode.TextDocument, position: vscode.Position) {
			const offset = document.offsetAt(position);
			const query = project.getOrCreate(document);
			const node = Utils.nodeAt(query, offset);

			if (node?._type === NodeType.VariableName) {
				const value = project.bindVariableValues().get(node.value);
				return new vscode.Hover('```\n' + String(value) + '\n```', project.rangeOf(node));
			}

			return undefined;
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
					result.push(new vscode.CompletionItem(
						symbol.name,
						symbol.kind === SymbolKind.Static ? vscode.CompletionItemKind.Enum : vscode.CompletionItemKind.Variable)
					);
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
	}, ':', '$'));

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

			let result: vscode.Location[] = [];
			for (let entry of project.all()) {
				Utils.walk(entry.node, (candidate, parent) => {
					if (candidate._type === NodeType.VariableName && candidate.value === node.value) {
						if (context.includeDeclaration || parent?._type !== NodeType.VariableDefinition) {
							result.push(new vscode.Location(entry.doc.uri, project.rangeOf(candidate)));
						}
					}
				});
			}
			return Promise.all(result);

		}
	}));

	// Rename
	// todo@jrieken consolidate with find references?
	context.subscriptions.push(vscode.languages.registerRenameProvider(selector, new class implements vscode.RenameProvider {
		prepareRename(document: vscode.TextDocument, position: vscode.Position) {
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const node = Utils.nodeAt(query, offset);
			if (node?._type !== NodeType.VariableName) {
				throw Error('Only variables names can be renamed');
			}
			return project.rangeOf(node, document.uri);
		}

		async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string) {
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const node = Utils.nodeAt(query, offset);

			if (node?._type === NodeType.VariableName) {
				// rename variable
				if (!newName.startsWith('$')) {
					newName = '$' + newName;
				}
				const scanner = new Scanner().reset(newName);
				if (scanner.next().type !== TokenType.VariableName || scanner.next().type !== TokenType.EOF) {
					throw new Error(`invalid name: ${newName}`);
				}
				const edit = new vscode.WorkspaceEdit();
				for (let entry of project.all()) {
					Utils.walk(entry.node, candidate => {
						if (candidate._type === NodeType.VariableName && candidate.value === node.value) {
							edit.replace(entry.doc.uri, project.rangeOf(candidate), newName);
						}
					});
				}
				return edit;
			}
		}
	}));

	// Document Highlights
	context.subscriptions.push(vscode.languages.registerDocumentHighlightProvider(selector, new class implements vscode.DocumentHighlightProvider {
		provideDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.DocumentHighlight[]> {
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const node = Utils.nodeAt(query, offset);
			if (node?._type !== NodeType.VariableName) {
				return;
			}
			const result: vscode.DocumentHighlight[] = [];
			Utils.walk(query, (candidate, parent) => {
				if (candidate._type === NodeType.VariableName && candidate.value === node.value) {
					result.push(new vscode.DocumentHighlight(
						project.rangeOf(candidate, document.uri),
						parent?._type === NodeType.VariableDefinition ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read
					));
				}
			});
			return Promise.all(result);
		}
	}));

	// Semantic Tokens
	const legend = new vscode.SemanticTokensLegend(['keyword'], ['']);
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, new class implements vscode.DocumentSemanticTokensProvider {

		provideDocumentSemanticTokens(document: vscode.TextDocument) {
			const builder = new vscode.SemanticTokensBuilder();
			const query = project.getOrCreate(document);
			Utils.walk(query, node => {
				if (node._type === NodeType.OrExpression) {
					const { line, character } = document.positionAt(node.or.start);
					builder.push(line, character, node.or.end - node.or.start, 0, 0);
				}
			});
			return new vscode.SemanticTokens(builder.build());
		}

	}, legend));

	// Validation
	const diagCollection = vscode.languages.createDiagnosticCollection();
	async function validateAll() {
		// add all
		vscode.workspace.textDocuments.forEach(doc => {
			if (vscode.languages.match(selector, doc)) {
				project.getOrCreate(doc);
			}
		});
		// validate all
		for (let { doc, node } of project.all()) {
			const diags: vscode.Diagnostic[] = [];
			const errors = validateQueryDocument(node, project.symbols);
			for (let error of errors) {
				const diag = new vscode.Diagnostic(project.rangeOf(error.node), error.message);
				if (error.conflictNode) {
					diag.relatedInformation = [new vscode.DiagnosticRelatedInformation(
						new vscode.Location(doc.uri, project.rangeOf(error.conflictNode)),
						project.textOf(error.conflictNode)
					)];
				}
				diags.push(diag);
			}
			diagCollection.set(doc.uri, diags);
		}
	}
	let handle: NodeJS.Timeout;
	function validateAllSoon() {
		clearTimeout(handle);
		handle = setTimeout(() => validateAll(), 200);
	}
	validateAllSoon();
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(() => validateAllSoon()));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => validateAllSoon()));
	// context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
	// 	diagnostcis.set(doc.uri, undefined);
	// }));
}

