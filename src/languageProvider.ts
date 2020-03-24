/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, NodeType, Utils } from './parser/nodes';
import { validateQueryDocument } from './parser/validation';
import { SymbolKind, sortValues } from './parser/symbols';
import { ProjectContainer } from './project';
import { Scanner, TokenType, Token } from './parser/scanner';


export function registerLanguageProvider(container: ProjectContainer): vscode.Disposable {

	const dispoables: vscode.Disposable[] = [];

	const selector = { language: 'github-issues' };

	vscode.languages.setLanguageConfiguration(selector.language, {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
		comments: { lineComment: '//' }
	});

	// // Hover (debug, ast)
	// dispoables.push(vscode.languages.registerHoverProvider(selector, new class implements vscode.HoverProvider {
	// 	async provideHover(document: vscode.TextDocument, position: vscode.Position) {
	// 		const offset = document.offsetAt(position);
	// 		const project = container.lookupProject(document.uri);
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
	dispoables.push(vscode.languages.registerHoverProvider(selector, new class implements vscode.HoverProvider {
		async provideHover(document: vscode.TextDocument, position: vscode.Position) {
			const offset = document.offsetAt(position);
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);
			const node = Utils.nodeAt(query, offset);

			if (node?._type === NodeType.VariableName) {
				const info = project.bindVariableValues().get(node.value);
				return new vscode.Hover(`\`${String(info?.value)}\` (${info?.type})`, project.rangeOf(node));
			}

			return undefined;
		}
	}));

	// Smart Select
	dispoables.push(vscode.languages.registerSelectionRangeProvider(selector, new class implements vscode.SelectionRangeProvider {
		async provideSelectionRanges(document: vscode.TextDocument, positions: vscode.Position[]) {
			const result: vscode.SelectionRange[] = [];
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);
			for (let position of positions) {
				const offset = document.offsetAt(position);
				const parents: Node[] = [];
				if (Utils.nodeAt(query, offset, parents)) {
					let last: vscode.SelectionRange | undefined;
					for (let node of parents) {
						let selRange = new vscode.SelectionRange(project.rangeOf(node), last);
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
	dispoables.push(vscode.languages.registerCompletionItemProvider(selector, new class implements vscode.CompletionItemProvider {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const parents: Node[] = [];
			const node = Utils.nodeAt(query, offset, parents) ?? query;
			const parent = parents[parents.length - 2];

			if (parent?._type === NodeType.SortBy) {
				// complete the sortby statement
				return [...sortValues].map(value => new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
			}

			if (node?._type === NodeType.Query || node._type === NodeType.Literal) {
				// globals
				const result = [...project.symbols.all()].map(symbol => new vscode.CompletionItem(
					symbol.name,
					symbol.kind === SymbolKind.Static ? vscode.CompletionItemKind.Enum : vscode.CompletionItemKind.Variable)
				);

				if (node._type !== NodeType.Query || !node.sortby) {
					// sort by
					result.push({
						label: 'sort asc by',
						kind: vscode.CompletionItemKind.Keyword,
						insertText: 'sort asc by ',
						command: { command: 'editor.action.triggerSuggest', title: '' }
					});
					result.push({
						label: 'sort desc by',
						kind: vscode.CompletionItemKind.Keyword,
						insertText: 'sort desc by ',
						command: { command: 'editor.action.triggerSuggest', title: '' }
					});
				}

				return result;
			}

			if (node?._type === NodeType.Missing && parent?._type === NodeType.QualifiedValue) {
				// complete a qualified expression
				const result: vscode.CompletionItem[] = [];
				const symbol = project.symbols.getFirst(parent.qualifier.value);
				if (symbol?.kind === SymbolKind.Static && Array.isArray(symbol.value)) {

					for (let set of symbol.value) {
						for (let value of set) {
							result.push(new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
						}
					}
				}
				return result;
			}
		}
	}, ':', '$'));

	// Definition
	dispoables.push(vscode.languages.registerDefinitionProvider(selector, new class implements vscode.DefinitionProvider {
		async provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const node = Utils.nodeAt(query, offset);
			if (node?._type !== NodeType.VariableName) {
				return;
			}
			const result: vscode.Location[] = [];
			for (const symbol of project.symbols.getAll(node.value)) {
				if (symbol.kind === SymbolKind.User) {
					result.push(new vscode.Location(symbol.uri, project.rangeOf(symbol.def, symbol.uri)));
				}
			}
			return result;
		}
	}));

	// References
	dispoables.push(vscode.languages.registerReferenceProvider(selector, new class implements vscode.ReferenceProvider {
		provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext): vscode.ProviderResult<vscode.Location[]> {
			const project = container.lookupProject(document.uri);
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
	dispoables.push(vscode.languages.registerRenameProvider(selector, new class implements vscode.RenameProvider {
		prepareRename(document: vscode.TextDocument, position: vscode.Position) {
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const node = Utils.nodeAt(query, offset);
			if (node?._type !== NodeType.VariableName) {
				throw Error('Only variables names can be renamed');
			}
			return project.rangeOf(node, document.uri);
		}

		async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string) {
			const project = container.lookupProject(document.uri);
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
	dispoables.push(vscode.languages.registerDocumentHighlightProvider(selector, new class implements vscode.DocumentHighlightProvider {
		provideDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.DocumentHighlight[]> {
			const project = container.lookupProject(document.uri);
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
	dispoables.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, new class implements vscode.DocumentSemanticTokensProvider {

		provideDocumentSemanticTokens(document: vscode.TextDocument) {
			const builder = new vscode.SemanticTokensBuilder();
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);

			const tokens: Token[] = [];

			Utils.walk(query, node => {
				if (node._type === NodeType.OrExpression) {
					tokens.push(node.or);
				}
				if (node._type === NodeType.SortBy) {
					tokens.push(node.keyword);
				}
			});

			for (let token of tokens.sort((a, b) => a.start - b.start)) {
				const { line, character } = document.positionAt(token.start);
				builder.push(line, character, token.end - token.start, 0, 0);
			}

			return new vscode.SemanticTokens(builder.build());
		}

	}, legend));

	// Validation
	const diagCollection = vscode.languages.createDiagnosticCollection();
	async function validateAll() {
		// add all
		vscode.workspace.textDocuments.forEach(doc => {
			if (vscode.languages.match(selector, doc)) {
				const project = container.lookupProject(doc.uri);
				const node = project.getOrCreate(doc);
				const newDiagnostics: vscode.Diagnostic[] = [];
				for (let error of validateQueryDocument(node, project.symbols)) {
					const diag = new vscode.Diagnostic(project.rangeOf(error.node), error.message);
					if (error.conflictNode) {
						diag.relatedInformation = [new vscode.DiagnosticRelatedInformation(
							new vscode.Location(doc.uri, project.rangeOf(error.conflictNode)),
							project.textOf(error.conflictNode)
						)];
					}
					newDiagnostics.push(diag);
				}
				diagCollection.set(doc.uri, newDiagnostics);
			}
		});
	}
	let handle: NodeJS.Timeout;
	function validateAllSoon() {
		clearTimeout(handle);
		handle = setTimeout(() => validateAll(), 200);
	}
	validateAllSoon();
	dispoables.push(vscode.workspace.onDidOpenTextDocument(() => validateAllSoon()));
	dispoables.push(vscode.workspace.onDidChangeTextDocument(() => validateAllSoon()));
	// dispoables.push(vscode.workspace.onDidCloseTextDocument(doc => {
	// 	diagnostcis.set(doc.uri, undefined);
	// }));

	return vscode.Disposable.from(...dispoables);
}
