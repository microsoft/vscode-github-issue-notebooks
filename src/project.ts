/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SymbolTable } from './parser/symbols';
import { QueryDocumentNode, Node, Utils, NodeType, QueryNode } from './parser/nodes';
import { Parser } from './parser/parser';
import { isRunnable } from './utils';

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

	has(doc: vscode.TextDocument): boolean {
		return this._cached.has(doc.uri.toString());
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

		function fillInQuery(node: QueryNode) {
			let sort: string | undefined;
			let order: 'asc' | 'desc' | undefined;
			if (node.sortby) {
				const value = Utils.print(node.sortby.value, entry.node.text, variableAccess);
				const idx = value.lastIndexOf('-');
				if (idx >= 0) {
					sort = value.substring(0, idx);
					order = value.substring(idx + 1) as any;
				}
			}
			result.push({
				q: Utils.print(node, entry.node.text, variableAccess),
				sort,
				order,
			});
		}

		function fillInQueryData(node: Node) {
			switch (node._type) {
				case NodeType.Query:
					fillInQuery(node);
					break;
				case NodeType.OrExpression:
					fillInQuery(node.left);
					// recurse
					fillInQueryData(node.right);
			}
		}

		const result: { q: string; sort?: string; order?: 'asc' | 'desc'; }[] = [];
		entry.node.nodes.forEach(fillInQueryData);
		return result;
	}
}

interface ProjectAssociation {
	(uri: vscode.Uri): boolean;
}

export class ProjectContainer {

	private _onDidRemove = new vscode.EventEmitter<Project>();
	readonly onDidRemove = this._onDidRemove.event;

	private _onDidChange = new vscode.EventEmitter<undefined>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _associations = new Map<string, [ProjectAssociation, Project]>();

	constructor() {

		this._disposables.push(vscode.notebook.onDidOpenNotebookDocument(document => {

			const key = document.uri.toString();
			if (this._associations.has(key)) {
				throw new Error(`Project for '${key}' already EXISTS. All projects: ${[...this._associations.keys()].join()}`);
			}

			const project = new Project();
			this._associations.set(key, [
				uri => document.cells.some(cell => cell.uri.toString() === uri.toString()),
				project
			]);

			try {
				document.cells.forEach(cell => project?.getOrCreate(cell.document));
			} catch (err) {
				console.error('FAILED to eagerly feed notebook cell document into project');
				console.error(err);
			}
		}));

		this._disposables.push(vscode.notebook.onDidCloseNotebookDocument(document => {
			const key = document.uri.toString();
			const tuple = this._associations.get(key);
			if (tuple) {
				this._associations.delete(key);
				this._onDidRemove.fire(tuple[1]);
			}
		}));

		this._disposables.push(vscode.notebook.onDidChangeNotebookCells(e => {
			let project = this.lookupProject(e.document.uri, false);
			if (project) {
				// added/removed cells -> fire blind update
				e.document.cells.forEach(cell => project?.getOrCreate(cell.document));
				this._rescanProjects();
			}
		}));
	}


	private _rescanProjects(): void {
		for (let [association, project] of this._associations.values()) {
			for (let { doc } of [...project.all()]) {
				if (!association(doc.uri)) {
					project.delete(doc);
				}
			}
		}
		this._onDidChange.fire(undefined);
	}

	lookupProject(uri: vscode.Uri): Project;
	lookupProject(uri: vscode.Uri, fallback: false): Project | undefined;
	lookupProject(uri: vscode.Uri, fallback: boolean = true): Project | undefined {

		// notebook uri itself
		let candidate = this._associations.get(uri.toString());
		if (candidate) {
			return candidate[1];
		}

		// a cell uri
		for (let [association, value] of this._associations.values()) {
			if (association(uri)) {
				return value;
			}
		}
		if (!fallback) {
			return undefined;
		}
		console.log('returning AD-HOC project for ' + uri.toString());
		return new Project();
	}

	* all(): Iterable<Project> {
		for (let [, value] of this._associations) {
			yield value[1];
		}
	}
}
