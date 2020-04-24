/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SymbolTable, ValueType } from './parser/symbols';
import { QueryDocumentNode, Node, Utils, NodeType } from './parser/nodes';
import { Parser } from './parser/parser';
import { TokenType } from './parser/scanner';

export class Project {

	private _nodeToUri = new WeakMap<Node, vscode.Uri>();
	private _cached = new Map<string, { versionParsed: number, doc: vscode.TextDocument, node: QueryDocumentNode; }>();
	private _parser = new Parser();

	readonly symbols: SymbolTable = new SymbolTable();

	getOrCreate(doc: vscode.TextDocument): QueryDocumentNode {
		let value = this._cached.get(doc.uri.toString());
		if (!value || value.versionParsed !== doc.version) {
			const text = doc.getText();
			value = {
				node: this._parser.parse(text, doc.uri.toString()),
				versionParsed: doc.version,
				doc
			};
			this._cached.set(doc.uri.toString(), value);
			this.symbols.update(value.node);
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

	private _lookUp(node?: Node, uri?: vscode.Uri) {
		if (!uri) {
			uri = this._nodeToUri.get(node!);
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

	queryData(doc: vscode.TextDocument) {
		const entry = this._lookUp(undefined, doc.uri);

		const variableAccess = (name: string) => this.symbols.getFirst(name)?.value;

		function fillInQueryData(node: Node) {
			switch (node._type) {
				case NodeType.Query:
					result.push({
						q: Utils.print(node, entry.node.text, variableAccess),
						sort: node.sortby && Utils.print(node.sortby, entry.node.text, variableAccess),
						order: node.sortby && node.sortby.keyword.type === TokenType.SortAscBy ? 'asc' : 'desc'
					});
					break;
				case NodeType.OrExpression:
					result.push({
						q: Utils.print(node.left, entry.node.text, variableAccess),
						sort: node.left.sortby && Utils.print(node.left.sortby, entry.node.text, variableAccess),
						order: node.left.sortby && node.left.sortby.keyword.type === TokenType.SortAscBy ? 'asc' : 'desc'
					});
					// recurse
					fillInQueryData(node.right);
			}
		}

		const result: { q: string; sort?: string; order?: 'asc' | 'desc'; }[] = [];
		entry.node.nodes.forEach(fillInQueryData);
		return result;
	}
}


export interface ProjectAssociation {
	(uri: vscode.Uri): boolean;
}

export class ProjectContainer {

	private readonly _associations = new Map<string, [ProjectAssociation, Project]>();

	register(uri: vscode.Uri, project: Project, association: ProjectAssociation) {
		this._associations.set(uri.toString(), [association, project]);
	}

	lookupProject(uri: vscode.Uri): Project;
	lookupProject(uri: vscode.Uri, fallback: false): Project | undefined;
	lookupProject(uri: vscode.Uri, fallback?: false): Project | undefined {
		for (let [association, value] of this._associations.values()) {
			if (association(uri)) {
				return value;
			}
		}
		if (!fallback) {
			return undefined;
		}
		console.log('returning AD-HOC project for ' + uri.toString());
		const project = new Project();
		this.register(uri, project, candidate => candidate.toString() === uri.toString());
		return project;
	}

	*all(): Iterable<Project> {
		for (let [, value] of this._associations) {
			yield value[1];
		}
	}
}
