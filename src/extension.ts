/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Parser } from './parser/parser';
import { Node, NodeList } from './parser/nodes';
import { Query } from "./parser/nodes";
import { validateQuery } from './parser/validation';
import { completeQuery, CompletionKind } from './parser/completion';
import { ValueType } from './parser/schema';

class QueryDocument {

	constructor(readonly ast: NodeList, readonly doc: vscode.TextDocument, readonly versionParsed: number) { }

	rangeOf(node: Node): vscode.Range {
		return new vscode.Range(this.doc.positionAt(node.start), this.doc.positionAt(node.end));
	}

	textOf(node: Node): string {
		return this.doc.getText().substring(node.start, node.end);
	}
}

class QueryDocuments {

	private _cached = new Map<string, QueryDocument>();
	private _parser = new Parser();

	getOrCreate(doc: vscode.TextDocument): QueryDocument {
		let value = this._cached.get(doc.uri.toString());
		if (!value || value.versionParsed !== doc.version) {
			value = new QueryDocument(this._parser.parse(doc.getText()), doc, doc.version);
			this._cached.set(doc.uri.toString(), value);
		}
		return value;
	}

	delete(doc: vscode.TextDocument): void {
		this._cached.delete(doc.uri.toString());
	}
};


export function activate(context: vscode.ExtensionContext) {

	const selector = { language: 'github-issues' };

	// manage syntax trees
	const queryDocs = new QueryDocuments();
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => queryDocs.delete(doc)));

	// Hover (debug)
	context.subscriptions.push(vscode.languages.registerHoverProvider(selector, new class implements vscode.HoverProvider {
		provideHover(document: vscode.TextDocument, position: vscode.Position) {
			const offset = document.offsetAt(position);
			const query = queryDocs.getOrCreate(document);
			const stack: Node[] = [];
			Query.nodeAt(query.ast, offset, stack);
			stack.shift();
			return new vscode.Hover(
				stack.map(node => `- \`${query.textOf(node)}\` (*${node._type}*)\n`).join(''),
				query.rangeOf(stack[stack.length - 1])
			);
		}
	}));

	// Smart Select
	context.subscriptions.push(vscode.languages.registerSelectionRangeProvider(selector, new class implements vscode.SelectionRangeProvider {
		provideSelectionRanges(document: vscode.TextDocument, positions: vscode.Position[]): vscode.ProviderResult<vscode.SelectionRange[]> {
			const result: vscode.SelectionRange[] = [];
			const query = queryDocs.getOrCreate(document);
			for (let position of positions) {
				const offset = document.offsetAt(position);
				const parents: Node[] = [];
				if (Query.nodeAt(query.ast, offset, parents)) {
					let last: vscode.SelectionRange | undefined;
					for (let node of parents) {
						let selRange = new vscode.SelectionRange(query.rangeOf(node), last);
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
			const query = queryDocs.getOrCreate(document);
			const offset = document.offsetAt(position);
			const result: vscode.CompletionItem[] = [];
			const completions = completeQuery(query.ast, offset);
			for (let item of completions) {
				if (item.type === CompletionKind.Literal) {
					result.push(new vscode.CompletionItem(item.value, vscode.CompletionItemKind.Value));
				} else {
					//todo@jrieken fetch the actual values of this type
					result.push(new vscode.CompletionItem(ValueType[item.valueType], vscode.CompletionItemKind.Value));
				}
			}
			return result;
		}
	}, ':'));

	// Validation
	const diagnostcis = vscode.languages.createDiagnosticCollection();
	function validateDoc(doc: vscode.TextDocument) {
		if (vscode.languages.match(selector, doc)) {
			const query = queryDocs.getOrCreate(doc);
			const errors = validateQuery(query.ast);
			const diag = [...errors].map(error => {
				const result = new vscode.Diagnostic(query.rangeOf(error.node), error.message);
				if (error.conflictNode) {
					result.relatedInformation = [new vscode.DiagnosticRelatedInformation(
						new vscode.Location(doc.uri, query.rangeOf(error.conflictNode)),
						query.textOf(error.conflictNode)
					)];
				}
				return result;
			});
			diagnostcis.set(doc.uri, diag);
		}
	}
	vscode.workspace.textDocuments.forEach(validateDoc);
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => diagnostcis.set(doc.uri, undefined)));
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(doc => validateDoc(doc)));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => validateDoc(e.document)));
}

