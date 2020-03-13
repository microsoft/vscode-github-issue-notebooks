/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Parser, Query, Node, QueryNode, } from './parser/parser';
import { validateQuery } from './parser/validation';

class QueryDocument {

	constructor(readonly ast: QueryNode, readonly doc: vscode.TextDocument, readonly versionParsed: number) { }

	rangeOf(node: Node): vscode.Range {
		return new vscode.Range(this.doc.positionAt(node.start), this.doc.positionAt(node.end));
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
			const node = Query.nodeAt(query.ast, offset);
			if (!node) {
				return;
			}
			return new vscode.Hover(
				`node_type: ${node._type} => ${document.getText().substring(node.start, node.end)}`,
				query.rangeOf(node)
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

	// Validation
	const diagnostcis = vscode.languages.createDiagnosticCollection();
	function validateDoc(doc: vscode.TextDocument) {
		if (vscode.languages.match(selector, doc)) {
			const query = queryDocs.getOrCreate(doc);
			const errors = validateQuery(query.ast);
			const diag = errors.map(error => new vscode.Diagnostic(query.rangeOf(error.node), error.message));
			diagnostcis.set(doc.uri, diag);
		}
	}
	vscode.workspace.textDocuments.forEach(validateDoc);
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => diagnostcis.set(doc.uri, undefined)));
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(doc => validateDoc(doc)));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => validateDoc(e.document)));
}

