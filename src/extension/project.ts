/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, NodeType, QualifiedValueNode, QueryDocumentNode, QueryNode, Utils } from './parser/nodes';
import { Parser } from './parser/parser';
import { SymbolTable } from './parser/symbols';

export class Project {

	private readonly _nodeToUri = new WeakMap<Node, vscode.Uri>();
	private readonly _cached = new Map<string, { versionParsed: number, doc: vscode.TextDocument, node: QueryDocumentNode; }>();
	private readonly _parser = new Parser();

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
			let sortby: Utils.PrintableNode | undefined;

			for (let candidate of node.nodes) {
				if (Utils.isSortExpression(candidate)) {
					sortby = (<QualifiedValueNode>candidate).value;
				} else if (candidate._type === NodeType.VariableName && variableAccess(candidate.value)?.match(/^sort:[\w-+\d]+-(asc|desc)+$/)) {
					sortby = candidate;
				}
			}

			if (sortby) {
				const value = Utils.print(sortby, entry.node.text, variableAccess);
				const idx = value.lastIndexOf('-');
				if (idx >= 0) {
					sort = value.substring(0, idx);
					order = value.substring(idx + 1) as any;
				}
			}
			result.push({
				q: Utils.print(node, entry.node.text, variableAccess, sortby && new Set([sortby])),
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

export class ProjectContainer {

	private _onDidRemove = new vscode.EventEmitter<Project>();
	readonly onDidRemove = this._onDidRemove.event;

	private _onDidChange = new vscode.EventEmitter<Project>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _associations = new Map<vscode.NotebookDocument, Project>();

	constructor() {

		this._disposables.push(vscode.notebook.onDidOpenNotebookDocument(notebook => {

			if (notebook.viewType !== 'github-issues') {
				return;
			}

			if (this._associations.has(notebook)) {
				throw new Error(`Project for '${notebook.uri.toString()}' already EXISTS. All projects: ${[...this._associations.keys()].map(nb => nb.uri.toString()).join()}`);
			}

			const project = new Project();
			this._associations.set(notebook, project);

			try {
				notebook.cells.forEach(cell => project?.getOrCreate(cell.document));
			} catch (err) {
				console.error('FAILED to eagerly feed notebook cell document into project');
				console.error(err);
			}

			this._onDidChange.fire(project);
		}));

		this._disposables.push(vscode.notebook.onDidCloseNotebookDocument(notebook => {
			const project = this._associations.get(notebook);
			if (project) {
				this._associations.delete(notebook);
				this._onDidRemove.fire(project);
			}
		}));

		this._disposables.push(vscode.notebook.onDidChangeNotebookCells(e => {
			let project = this.lookupProject(e.document.uri, false);
			if (!project) {
				return;
			}
			for (let change of e.changes) {
				for (let cell of change.deletedItems) {
					project.delete(cell.document);
				}
				for (let cell of change.items) {
					project.getOrCreate(cell.document);
				}
			}
			this._onDidChange.fire(project);
		}));
	}

	lookupProject(uri: vscode.Uri): Project;
	lookupProject(uri: vscode.Uri, fallback: false): Project | undefined;
	lookupProject(uri: vscode.Uri, fallback: boolean = true): Project | undefined {

		for (let [notebook, project] of this._associations) {
			if (notebook.uri.toString() === uri.toString()) {
				// notebook uri itself
				return project;
			}
			for (let cell of notebook.cells) {
				if (cell.uri.toString() === uri.toString()) {
					// a cell uri
					return project;
				}
			}
		}
		if (!fallback) {
			return undefined;
		}
		console.log('returning AD-HOC project for ' + uri.toString());
		return new Project();
	}

	all(): Iterable<Project> {
		return this._associations.values();
	}
}
