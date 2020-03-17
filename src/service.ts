/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SymbolTable, SymbolKind, UserSymbol } from './parser/symbols';
import { QueryDocumentNode, Node, Utils } from './parser/nodes';
import { Parser } from './parser/parser';

export class QueryDocumentProject {

    private _nodeToUri = new WeakMap<Node, vscode.Uri>();
    private _cached = new Map<string, { versionParsed: number, doc: vscode.TextDocument, node: QueryDocumentNode; }>();
    private _parser = new Parser();

    readonly symbols: SymbolTable = new SymbolTable();

    getOrCreate(doc: vscode.TextDocument): QueryDocumentNode {
        let value = this._cached.get(doc.uri.toString());
        if (!value || value.versionParsed !== doc.version) {
            const text = doc.getText();
            value = {
                node: this._parser.parse(text),
                versionParsed: doc.version,
                doc
            };
            this._cached.set(doc.uri.toString(), value);
            this.symbols.update(value.node, value.doc.uri);
            Utils.walk(value.node, node => this._nodeToUri.set(node, doc.uri));
        }
        return value.node;
    }

    delete(doc: vscode.TextDocument): void {
        this._cached.delete(doc.uri.toString());
    }

    all() {
        return this._cached.values();
    }

    private _lookUp(node: Node, uri?: vscode.Uri) {
        if (!uri) {
            uri = this._nodeToUri.get(node);
        }
        if (!uri) {
            throw new Error('unknown node');
        }
        const entry = this._cached.get(uri.toString());
        if (!entry) {
            throw new Error('unknown file' + uri);
        }
        return entry;
    }

    rangeOf(node: Node, uri?: vscode.Uri) {
        const entry = this._lookUp(node, uri);
        return new vscode.Range(entry.doc.positionAt(node.start), entry.doc.positionAt(node.end));
    }

    textOf(node: Node, uri?: vscode.Uri) {
        const { doc } = this._lookUp(node, uri);
        const range = new vscode.Range(doc.positionAt(node.start), doc.positionAt(node.end));
        return doc.getText(range);
    }

    emit(query: QueryDocumentNode, uri?: vscode.Uri) {
        const entry = this._lookUp(query, uri);
        const variableValues = this.bindVariableValues();
        return Utils.print(query, { text: entry.doc.getText(), variableValues });
    }

    bindVariableValues() {
        // all user defined
        const symbols: UserSymbol[] = [];
        for (let symbol of this.symbols.all()) {
            if (symbol.kind === SymbolKind.User) {
                symbols.push(symbol);
            }
        }
        // sort by position
        symbols.sort((a, b) => {
            if (a.uri.toString() < b.uri.toString()) {
                return -1;
            } else if (a.uri.toString() > b.uri.toString()) {
                return 1;
            } else {
                return a.def.start - b.def.start;
            }
        });
        // print symbol from definition
        const result = new Map<string, string>();
        for (let symbol of symbols) {
            const entry = this._cached.get(symbol.uri.toString())!;
            const value = Utils.print(symbol.def.value, { text: entry.doc.getText(), variableValues: result });
            result.set(symbol.name, '' + value);
        }
        return result;
    }
}
