/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SymbolTable } from './parser/symbols';
import { QueryDocumentNode, Node, Utils } from './parser/nodes';
import { Parser } from './parser/parser';

export class QueryDocumentProject {

    private _nodeToUri = new WeakMap<Node, vscode.Uri>();
    private _cached = new Map<string, { versionParsed: number, uri: vscode.Uri, node: QueryDocumentNode; }>();
    private _parser = new Parser();

    readonly symbols: SymbolTable = new SymbolTable();

    getOrCreate(doc: vscode.TextDocument): QueryDocumentNode {
        let value = this._cached.get(doc.uri.toString());
        if (!value || value.versionParsed !== doc.version) {
            value = {
                node: this._parser.parse(doc.getText()),
                versionParsed: doc.version,
                uri: doc.uri
            };
            this._cached.set(doc.uri.toString(), value);
            this.symbols.update(value.node, value.uri);
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

    async rangeOf(node: Node, uri?: vscode.Uri) {
        if (!uri) {
            uri = this._nodeToUri.get(node);
        }
        if (!uri) {
            throw new Error('unknown node');
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        const range = new vscode.Range(doc.positionAt(node.start), doc.positionAt(node.end));
        return range;
    }

    async textOf(node: Node, uri?: vscode.Uri) {
        if (!uri) {
            uri = this._nodeToUri.get(node);
        }
        if (!uri) {
            throw new Error('unknown node');
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        const range = new vscode.Range(doc.positionAt(node.start), doc.positionAt(node.end));
        return doc.getText(range);
    }
}
