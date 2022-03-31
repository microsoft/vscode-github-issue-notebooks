/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, NodeType, QueryDocumentNode, QueryNode, Utils } from './parser/nodes';
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
		this.symbols.delete(doc.uri.toString());
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

	getLocation(node: Node) {
		const data = this._lookUp(node);
		return new vscode.Location(
			data.doc.uri,
			new vscode.Range(data.doc.positionAt(node.start), data.doc.positionAt(node.end))
		);
	}

	queryData(queryNode: QueryDocumentNode) {

		const variableAccess = (name: string) => this.symbols.getFirst(name)?.value;

		function fillInQuery(node: QueryNode) {
			let sort: string | undefined;
			let order: 'asc' | 'desc' | undefined;

			// TODO@jrieken
			// this is hacky, but it works. We first print the node *with* sortby-statements
			// and then use a regex to remove and capture the sortby-information
			const textWithSortBy = Utils.print(node, queryNode.text, variableAccess);
			const query = textWithSortBy.replace(/sort:([\w-+\d]+)-(asc|desc)/g, function (_m, g1, g2) {
				sort = g1 ?? undefined;
				order = g2 ?? undefined;
				return '';
			}).trim();

			result.push({
				q: query,
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
		queryNode.nodes.forEach(fillInQueryData);
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

		this._disposables.push(vscode.workspace.onDidOpenNotebookDocument(notebook => {

			if (notebook.notebookType !== 'github-issues') {
				return;
			}

			if (this._associations.has(notebook)) {
				throw new Error(`Project for '${notebook.uri.toString()}' already EXISTS. All projects: ${[...this._associations.keys()].map(nb => nb.uri.toString()).join()}`);
			}

			const project = new Project();
			this._associations.set(notebook, project);

			try {
				for (const cell of notebook.getCells()) {
					if (cell.kind === vscode.NotebookCellKind.Code) {
						project.getOrCreate(cell.document);
					}
				}
			} catch (err) {
				console.error('FAILED to eagerly feed notebook cell document into project');
				console.error(err);
			}

			this._onDidChange.fire(project);
		}));

		this._disposables.push(vscode.workspace.onDidCloseNotebookDocument(notebook => {
			const project = this._associations.get(notebook);
			if (project) {
				this._associations.delete(notebook);
				this._onDidRemove.fire(project);
			}
		}));

		this._disposables.push(vscode.workspace.onDidChangeNotebookDocument(e => {
			let project = this.lookupProject(e.notebook.uri, false);
			if (!project) {
				return;
			}
			for (let change of e.contentChanges) {
				for (let cell of change.removedCells) {
					project.delete(cell.document);
				}
				for (const cell of change.addedCells) {
					if (cell.kind === vscode.NotebookCellKind.Code) {
						project.getOrCreate(cell.document);
					}
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
			for (let cell of notebook.getCells()) {
				if (cell.document.uri.toString() === uri.toString()) {
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
