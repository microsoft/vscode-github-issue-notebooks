/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { withEmoji } from '../common/emoji';
import { GithubData } from './githubDataProvider';
import { OctokitProvider } from './octokitProvider';
import { LiteralSequenceNode, Node, NodeType, QualifiedValueNode, QueryDocumentNode, QueryNode, Utils } from './parser/nodes';
import { Scanner, Token, TokenType } from './parser/scanner';
import { QualifiedValueNodeSchema, SymbolInfo, ValuePlaceholderType } from './parser/symbols';
import { Code, ValidationError, validateQueryDocument } from './parser/validation';
import { Project, ProjectContainer } from './project';
import { RepoInfo, getAllRepos } from './utils';

const selector = { language: 'github-issues' };

export class HoverProvider implements vscode.HoverProvider {

	constructor(readonly container: ProjectContainer) { }

	async provideHover(document: vscode.TextDocument, position: vscode.Position) {
		const offset = document.offsetAt(position);
		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);
		const parents: Node[] = [];
		const node = Utils.nodeAt(query, offset, parents);

		if (node?._type === NodeType.VariableName) {

			let info: SymbolInfo | undefined;
			for (let candidate of project.symbols.getAll(node.value)) {
				//
				if (!info) {
					info = candidate;
					continue;
				}
				if (project.getLocation(info.def).uri.toString() === document.uri.toString()) {
					if (project.getLocation(candidate.def).uri.toString() !== document.uri.toString()) {
						break;
					}
				}
				if (candidate.timestamp > info.timestamp) {
					info = candidate;
				}
			}
			return new vscode.Hover(`\`${info?.value}\`${info?.type ? ` (${info.type})` : ''}`, project.rangeOf(node));
		}

		if (node?._type === NodeType.Literal && parents[parents.length - 2]?._type === NodeType.QualifiedValue) {
			const info = QualifiedValueNodeSchema.get(node.value);
			return info?.description && new vscode.Hover(info.description) || undefined;
		}

		return undefined;
	}
}

export class SelectionRangeProvider implements vscode.SelectionRangeProvider {

	constructor(readonly container: ProjectContainer) { }

	async provideSelectionRanges(document: vscode.TextDocument, positions: vscode.Position[]) {
		const result: vscode.SelectionRange[] = [];
		const project = this.container.lookupProject(document.uri);
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
}

export class DocumentHighlightProvider implements vscode.DocumentHighlightProvider {
	constructor(readonly container: ProjectContainer) { }

	provideDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.DocumentHighlight[]> {
		const project = this.container.lookupProject(document.uri);
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
}

export class DefinitionProvider implements vscode.DefinitionProvider {

	constructor(readonly container: ProjectContainer) { }

	async provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);
		const offset = document.offsetAt(position);
		const node = Utils.nodeAt(query, offset);
		if (node?._type !== NodeType.VariableName) {
			return;
		}
		const result: vscode.Location[] = [];
		for (const symbol of project.symbols.getAll(node.value)) {
			result.push(project.getLocation(symbol.def));
		}
		return result;
	}
}

export class ReferenceProvider implements vscode.ReferenceProvider {

	constructor(readonly container: ProjectContainer) { }

	provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext): vscode.ProviderResult<vscode.Location[]> {
		const project = this.container.lookupProject(document.uri);
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
}

export class RenameProvider implements vscode.RenameProvider {

	constructor(readonly container: ProjectContainer) { }

	prepareRename(document: vscode.TextDocument, position: vscode.Position) {
		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);
		const offset = document.offsetAt(position);
		const node = Utils.nodeAt(query, offset);
		if (node?._type !== NodeType.VariableName) {
			throw Error('Only variables names can be renamed');
		}
		return project.rangeOf(node, document.uri);
	}

	async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string) {
		const project = this.container.lookupProject(document.uri);
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
}

export class FormattingProvider implements vscode.DocumentRangeFormattingEditProvider, vscode.OnTypeFormattingEditProvider {

	constructor(readonly container: ProjectContainer) { }

	provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string) {

		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);

		const nodes: Node[] = [];
		Utils.nodeAt(query, document.offsetAt(position) - ch.length, nodes);

		const target = nodes.find(node => node._type === NodeType.Query || node._type === NodeType.VariableDefinition || node._type === NodeType.OrExpression);
		if (target) {
			return this._formatNode(project, query, target);
		}
	}

	provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range) {

		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);

		// find node starting and ending in range
		let target: Node = query;
		const nodesStart: Node[] = [];
		const nodesEnd: Node[] = [];
		Utils.nodeAt(query, document.offsetAt(range.start), nodesStart);
		Utils.nodeAt(query, document.offsetAt(range.end), nodesEnd);
		for (let node of nodesStart) {
			if (nodesEnd.includes(node)) {
				target = node;
				break;
			}
		}
		return this._formatNode(project, query, target);
	}

	private _formatNode(project: Project, query: QueryDocumentNode, node: Node): vscode.TextEdit[] {
		// format a single node
		if (node._type !== NodeType.QueryDocument) {
			return [vscode.TextEdit.replace(
				project.rangeOf(node),
				this._printForFormatting(query, node)
			)];
		}
		// format whole document
		let result: vscode.TextEdit[] = [];
		for (let child of node.nodes) {
			const range = project.rangeOf(child);
			const newText = this._printForFormatting(query, child);
			result.push(vscode.TextEdit.replace(range, newText));
		}
		return result;
	}

	private _printForFormatting(query: QueryDocumentNode, node: Exclude<Node, QueryDocumentNode>): string {
		if (node._type === NodeType.OrExpression) {
			// special...
			return `${this._printForFormatting(query, node.left)} OR ${this._printForFormatting(query, node.right)}`;
		} else if (node._type === NodeType.VariableDefinition) {
			// special...
			return `${this._printForFormatting(query, node.name)}=${this._printForFormatting(query, node.value)}`;
		} else {
			return Utils.print(node, query.text, () => undefined);
		}
	}
}

export class DocumentSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {

	static readonly legend = new vscode.SemanticTokensLegend(['keyword']);

	constructor(readonly container: ProjectContainer) { }

	provideDocumentSemanticTokens(document: vscode.TextDocument) {

		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);

		const builder = new vscode.SemanticTokensBuilder();
		Utils.walk(query, node => {
			let token: Token | undefined;
			if (node._type === NodeType.OrExpression) {
				token = node.or;
			}
			if (token) {
				const { line, character } = document.positionAt(token.start);
				builder.push(line, character, token.end - token.start, 0);
			}
		});
		return builder.build();
	}
}

export class CompletionItemProvider implements vscode.CompletionItemProvider {

	static readonly triggerCharacters = [':', '$'];

	constructor(readonly container: ProjectContainer) { }

	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {
		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);
		const offset = document.offsetAt(position);
		const parents: Node[] = [];
		const node = Utils.nodeAt(query, offset, parents) ?? query;
		const parent = parents[parents.length - 2];

		if (parent?._type === NodeType.LiteralSequence) {
			return;
		}

		if (parent?._type === NodeType.QualifiedValue && (node._type === NodeType.Literal || node._type === NodeType.Missing) && node === parent.value) {
			// RHS of a qualified value => complete value set
			const replacing = project.rangeOf(node);
			const inserting = replacing.with(undefined, position);
			const result: vscode.CompletionItem[] = [];
			const info = QualifiedValueNodeSchema.get(parent.qualifier.value);
			if (info?.enumValues) {
				for (let set of info.enumValues) {
					for (let value of set.entries) {
						result.push({
							label: value,
							kind: vscode.CompletionItemKind.EnumMember,
							range: { inserting, replacing }
						});
					}
				}
			}
			return result;
		}

		if (node?._type === NodeType.QueryDocument || node?._type === NodeType.Query || node._type === NodeType.Literal || node._type === NodeType.VariableName) {
			const result: vscode.CompletionItem[] = [];

			// names of qualified value node
			for (let [key, value] of QualifiedValueNodeSchema) {
				result.push({
					label: key,
					kind: vscode.CompletionItemKind.Enum,
					documentation: value.description
				});
			}

			// all variables
			for (let symbol of project.symbols.all()) {
				result.push({
					label: { label: symbol.name, description: symbol.type ? `${symbol.value} (${symbol.type})` : symbol.value },
					kind: vscode.CompletionItemKind.Variable,
				});
			}
			return result;
		}
	}
}

export class QuickFixProvider implements vscode.CodeActionProvider {

	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext) {
		const result: vscode.CodeAction[] = [];
		for (let diag of context.diagnostics) {
			if (diag instanceof LanguageValidationDiagnostic && document.version === diag.docVersion) {

				// remove conflicting value
				if (diag.code === Code.ValueConflict) {
					const action = new vscode.CodeAction('Remove This', vscode.CodeActionKind.QuickFix);
					action.diagnostics = [diag];
					action.edit = new vscode.WorkspaceEdit();
					action.edit.delete(document.uri, diag.range);
					result.push(action);
				}

				// replace with value set entry
				if (diag.error.code === Code.ValueUnknown) {
					const action = new vscode.CodeAction('Replace with Valid Value', vscode.CodeActionKind.QuickFix);
					action.diagnostics = [diag];
					action.edit = new vscode.WorkspaceEdit();
					action.edit.set(document.uri, [vscode.SnippetTextEdit.replace(diag.range, new vscode.SnippetString().appendChoice(Array.from(diag.error.expected).map(set => [...set.entries]).flat()))]);
					result.push(action);
				}
			}

			if (diag.code === Code.GitHubLoginNeeded) {
				const loginForAtMe = vscode.l10n.t('Login for {0}', '@me');
				const action = new vscode.CodeAction(loginForAtMe, vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diag];
				action.command = { command: 'github-issues.authNow', title: loginForAtMe };
				result.push(action);

			}
		}
		return result;
	}
}

export class ExtractVariableProvider implements vscode.CodeActionProvider {

	constructor(readonly container: ProjectContainer) { }


	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {

		if (context.triggerKind !== vscode.CodeActionTriggerKind.Invoke || range.isEmpty) {
			return;
		}

		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);

		// find common ancestor 
		const start = document.offsetAt(range.start);
		const end = document.offsetAt(range.end);
		const startStack: Node[] = [];
		const endStack: Node[] = [];
		Utils.nodeAt(query, start, startStack);
		Utils.nodeAt(query, end, endStack);
		let ancestor: Node | undefined = undefined;
		for (let i = 0; i < startStack.length && endStack.length; i++) {
			if (startStack[i] !== endStack[i]) {
				break;
			}
			ancestor = startStack[i];
		}

		if (!ancestor || ancestor._type !== NodeType.QualifiedValue) {
			return;
		}

		const action = new vscode.CodeAction('Extract As Variable', vscode.CodeActionKind.RefactorExtract);
		action.edit = new vscode.WorkspaceEdit();
		action.edit.set(document.uri, [
			vscode.SnippetTextEdit.insert(project.rangeOf(query, document.uri).start, new vscode.SnippetString().appendText('$').appendPlaceholder(ancestor.qualifier.value.toUpperCase(), 1).appendText(`=${Utils.print(ancestor, query.text, () => undefined)}\n\n`)),
			vscode.SnippetTextEdit.replace(project.rangeOf(ancestor, document.uri), new vscode.SnippetString().appendText('$').appendTabstop(1))
		]);
		return [action];
	}
}

export class NotebookSplitOrIntoCellProvider implements vscode.CodeActionProvider {

	constructor(readonly container: ProjectContainer) { }

	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, _context: vscode.CodeActionContext): vscode.ProviderResult<vscode.CodeAction[]> {

		let cell: vscode.NotebookCell | undefined;
		for (let candidate of vscode.workspace.notebookDocuments) {
			for (let item of candidate.getCells()) {
				if (item.document === document) {
					cell = item;
				}
			}
		}
		if (!cell) {
			return undefined;
		}

		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);

		const result: vscode.CodeAction[] = [];
		for (const node of query.nodes) {
			if (node._type === NodeType.OrExpression) {
				const orNodeRange = project.rangeOf(node, document.uri);
				if (!_range.intersection(orNodeRange)) {
					continue;
				}

				const nodes: QueryNode[] = [];
				const stack = [node];
				while (stack.length > 0) {
					let s = stack.pop()!;
					nodes.push(s.left);
					if (s.right._type === NodeType.OrExpression) {
						stack.push(s.right);
					} else {
						nodes.push(s.right);
					}
				}

				// split into cells
				const action1 = new vscode.CodeAction(vscode.l10n.t('Split OR into Cells'), vscode.CodeActionKind.RefactorRewrite);
				action1.edit = new vscode.WorkspaceEdit();
				action1.edit.set(document.uri, [vscode.TextEdit.delete(orNodeRange)]);
				action1.edit.set(cell.notebook.uri, [vscode.NotebookEdit.insertCells(
					cell.index + 1,
					nodes.map(node => ({
						kind: vscode.NotebookCellKind.Code,
						languageId: document.languageId,
						value: Utils.print(node, query.text, _name => undefined)
					}))
				)]);

				// split into statements
				const action2 = new vscode.CodeAction(vscode.l10n.t('Split OR into Statements'), vscode.CodeActionKind.RefactorRewrite);
				action2.edit = new vscode.WorkspaceEdit();
				action2.edit.set(document.uri, [vscode.TextEdit.replace(
					orNodeRange,
					nodes.map(node => Utils.print(node, query.text, _name => undefined)).join('\n')
				)]);

				result.push(action1);
				result.push(action2);
			}
		}
		return result;
	}
}

export class NotebookExtractCellProvider implements vscode.CodeActionProvider {

	constructor(readonly container: ProjectContainer) { }

	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext): vscode.ProviderResult<vscode.CodeAction[]> {

		if (context.triggerKind !== vscode.CodeActionTriggerKind.Invoke) {
			return undefined;
		}

		let cell: vscode.NotebookCell | undefined;
		for (let candidate of vscode.workspace.notebookDocuments) {
			for (let item of candidate.getCells()) {
				if (item.document === document) {
					cell = item;
				}
			}
		}
		if (!cell) {
			return undefined;
		}

		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);

		let usesVariables = false;
		let definesVariables = false;

		Utils.walk(query, (node, parent) => {
			usesVariables = usesVariables || node._type === NodeType.VariableName && parent?._type !== NodeType.VariableDefinition;
			definesVariables = definesVariables || node._type === NodeType.VariableDefinition;
		});

		if (usesVariables) {
			return;
		}

		const filename = `${cell.notebook.uri.path.substring(cell.notebook.uri.path.lastIndexOf('/') + 1)}-cell-${Math.random().toString(16).slice(2, 7)}.github-issues`;
		const newNotebookUri = vscode.Uri.joinPath(cell.notebook.uri, `../${filename}`);

		const action = new vscode.CodeAction(
			definesVariables ? vscode.l10n.t('Copy Cell Into New Notebook') : vscode.l10n.t('Move Cell Into New Notebook'),
			vscode.CodeActionKind.RefactorMove
		);
		action.edit = new vscode.WorkspaceEdit();
		action.edit.createFile(newNotebookUri, { ignoreIfExists: false });
		action.edit.set(newNotebookUri, [vscode.NotebookEdit.insertCells(0, [{ kind: vscode.NotebookCellKind.Code, languageId: document.languageId, value: cell.document.getText() }])]);
		action.command = { command: 'vscode.open', title: 'Show Notebook', arguments: [newNotebookUri] };
		if (!definesVariables) {
			action.edit.set(cell.notebook.uri, [vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(cell.index, cell.index + 1))]);
		}

		return [action];
	}
}

export class VariableNamesSourceAction implements vscode.CodeActionProvider {

	static kind = vscode.CodeActionKind.Notebook.append('source.normalizeVariableNames');

	constructor(readonly container: ProjectContainer) {

	}

	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, _context: vscode.CodeActionContext): vscode.ProviderResult<vscode.CodeAction[]> {

		const project = this.container.lookupProject(document.uri);

		// (1) find all defined variables, map them onto upper-cased name
		const defs = new Map<string, string>();
		for (let entry of project.all()) {
			Utils.walk(entry.node, node => {
				switch (node._type) {
					case NodeType.VariableDefinition:
						const newName = node.name.value.toUpperCase();
						if (node.name.value !== newName) {
							defs.set(node.name.value, newName);
						}
						break;
				}
			});
		}

		// (2) make sure not to collide with existing names
		let counter = 1;
		for (const [oldName, newName] of defs) {
			if (defs.has(newName)) {
				// conflict
				defs.set(oldName, `${newName}${counter++}`);
			}
		}

		// (3) create edits for all occurrences
		const edit = new vscode.WorkspaceEdit();
		for (let entry of project.all()) {
			Utils.walk(entry.node, candidate => {
				if (candidate._type === NodeType.VariableName) {
					const newName = defs.get(candidate.value);
					if (newName && newName !== candidate.value) {
						edit.replace(entry.doc.uri, project.rangeOf(candidate), newName);
						// console.log(`CONTEXT ${document.uri.toString()}, FILE: ${entry.doc.uri.toString()}, RENAME ${candidate.value} -> ${newName}`);
					}
				}
			});
		}

		if (edit.entries().length === 0) {
			// nothing to do
			return;
		}

		const codeAction = new vscode.CodeAction('Normalize Variable Names');
		codeAction.kind = VariableNamesSourceAction.kind;
		codeAction.edit = edit;
		return [codeAction];
	}
}

export class GithubOrgCompletions implements vscode.CompletionItemProvider {

	static readonly triggerCharacters = [':'];

	constructor(readonly container: ProjectContainer, readonly octokitProvider: OctokitProvider) { }

	async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {

		const project = this.container.lookupProject(document.uri);
		const doc = project.getOrCreate(document);
		const offset = document.offsetAt(position);
		const parents: Node[] = [];
		const node = Utils.nodeAt(doc, offset, parents) ?? doc;
		const qualified = parents[parents.length - 2];
		const query = parents[parents.length - 3];

		if (query?._type !== NodeType.Query || qualified?._type !== NodeType.QualifiedValue || node !== qualified.value) {
			return;
		}

		const inserting = new vscode.Range(document.positionAt(qualified.value.start), position);
		const replacing = new vscode.Range(document.positionAt(qualified.value.start), document.positionAt(qualified.value.end));
		const range = { inserting, replacing };

		const octokit = await this.octokitProvider.lib();
		if (!this.octokitProvider.isAuthenticated) {
			return;
		}

		const info = QualifiedValueNodeSchema.get(qualified.qualifier.value);

		if (info?.placeholderType === ValuePlaceholderType.Orgname) {
			type OrgInfo = { login: string; };
			const user = await octokit.users.getAuthenticated();
			const options = octokit.orgs.listForUser.endpoint.merge({ username: user.data.login, });
			return octokit.paginate<OrgInfo>(<any>options).then(values => values.map(value => new vscode.CompletionItem(value.login)));
		}

		if (info?.placeholderType === ValuePlaceholderType.Repository) {
			type RepoInfo = { full_name: string; html_url: string; description: string; };
			const response = await octokit.repos.listForAuthenticatedUser({ per_page: 100, sort: 'pushed', affiliation: 'owner,collaborator' });
			return (<RepoInfo[]>response.data).map(value => ({ label: value.full_name, range, documentation: new vscode.MarkdownString().appendMarkdown(`${value.description ?? value.full_name}\n\n${value.html_url}`) }));
		}
	}
}

export class GithubRepoSearchCompletions implements vscode.CompletionItemProvider {

	static readonly triggerCharacters = [':', '/'];

	constructor(readonly container: ProjectContainer, readonly octokitProvider: OctokitProvider) { }

	async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
		const project = this.container.lookupProject(document.uri);
		const doc = project.getOrCreate(document);
		const offset = document.offsetAt(position);
		const parents: Node[] = [];
		const node = Utils.nodeAt(doc, offset, parents) ?? doc;
		const qualified = parents[parents.length - 2];
		const query = parents[parents.length - 3];

		if (query?._type !== NodeType.Query || qualified?._type !== NodeType.QualifiedValue || node !== qualified.value) {
			return;
		}

		const info = QualifiedValueNodeSchema.get(qualified.qualifier.value);
		if (info?.placeholderType !== ValuePlaceholderType.Repository) {
			return;
		}

		const inserting = new vscode.Range(document.positionAt(qualified.value.start), position);
		const replacing = new vscode.Range(document.positionAt(qualified.value.start), document.positionAt(qualified.value.end));
		const range = { inserting, replacing };

		// craft repo-query
		const len = document.offsetAt(position) - qualified.value.start;
		let q = Utils.print(qualified.value, doc.text, name => project.symbols.getFirst(name)?.value).substr(0, len);
		if (!q) {
			return new vscode.CompletionList([], true);
		}
		const idx = q.indexOf('/');
		if (idx > 0) {
			q = `org:${q.substr(0, idx)} ${q.substr(idx + 1)}`;
		}

		const octokit = await this.octokitProvider.lib();
		const repos = await octokit.search.repos({ q, per_page: 10 });

		// create completion items
		const items = repos.data.items.map(item => {
			return <vscode.CompletionItem>{
				label: item.full_name,
				description: new vscode.MarkdownString().appendMarkdown(`${item.description ?? item.full_name}\n\n${item.html_url}`),
				range,
			};
		});

		const incomplete = repos.data.total_count > repos.data.items.length;
		const result = new vscode.CompletionList(items, incomplete);
		return result;
	}
}

export class GithubPlaceholderCompletions implements vscode.CompletionItemProvider {

	static readonly triggerCharacters = [':', ','];

	constructor(
		readonly container: ProjectContainer,
		private readonly _githubData: GithubData
	) { }

	async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {

		const project = this.container.lookupProject(document.uri);
		const doc = project.getOrCreate(document);
		const offset = document.offsetAt(position);

		// node chain at offset
		const parents: Node[] = [];
		Utils.nodeAt(doc, offset, parents) ?? doc;

		// find query, qualified, maybe sequence, and literal in the node chain
		let query: QueryNode | undefined;
		let qualified: QualifiedValueNode | undefined;
		let sequence: LiteralSequenceNode | undefined;
		let literal: Node | undefined;

		for (const node of parents) {
			switch (node._type) {
				case NodeType.Query:
					query = node;
					break;
				case NodeType.QualifiedValue:
					qualified = node;
					break;
				case NodeType.LiteralSequence:
					sequence = node;
					break;
				case NodeType.Literal:
				case NodeType.Missing:
					literal = node;
					break;
			}
		}

		if (!query || !qualified) {
			return;
		}

		if (!sequence && qualified.value !== literal) {
			// qualif|ier:value
			return;
		}

		const repos = getAllRepos(project);
		const info = QualifiedValueNodeSchema.get(qualified.qualifier.value);

		let range = { inserting: new vscode.Range(position, position), replacing: new vscode.Range(position, position) };
		if (literal) {
			const inserting = new vscode.Range(document.positionAt(literal.start), position);
			const replacing = new vscode.Range(document.positionAt(literal.start), document.positionAt(literal.end));
			range = { inserting, replacing };
		}

		if (info?.placeholderType === ValuePlaceholderType.Label || sequence) {
			return this._completeLabels(repos, literal ? undefined : sequence, range);
		} else if (info?.placeholderType === ValuePlaceholderType.Milestone) {
			return this._completeMilestones(repos, range);
		} else if (info?.placeholderType === ValuePlaceholderType.Username) {
			return this._completeUsernames(repos, range);
		}
	}

	private async _completeLabels(repos: Iterable<RepoInfo>, sequence: LiteralSequenceNode | undefined, range: { inserting: vscode.Range, replacing: vscode.Range; }) {
		const result = new Map<string, vscode.CompletionItem>();

		// label:foo,bar,|
		const isUseInSequence = sequence && new Set(sequence.nodes.map(node => node.value));

		for (let info of repos) {

			const labels = await this._githubData.getOrFetchLabels(info);
			for (const label of labels) {

				if (isUseInSequence?.has(label.name)) {
					continue;
				}

				let existing = result.get(label.name);
				if (existing) {
					existing.detail = undefined;
					existing.kind = vscode.CompletionItemKind.Constant;
					existing.documentation = undefined;
					existing.sortText = String.fromCharCode(0) + existing.label;
				} else {
					result.set(label.name, {
						label: { label: withEmoji(label.name), description: label.description },
						range,
						kind: vscode.CompletionItemKind.Color,
						documentation: `#${label.color}`,
						insertText: label.name.match(/\s/) ? `"${label.name}"` : undefined,
						filterText: label.name.match(/\s/) ? `"${label.name}"` : undefined
					});
				}
			}
		}
		return [...result.values()];
	}

	private async _completeMilestones(repos: Iterable<RepoInfo>, range?: { inserting: vscode.Range, replacing: vscode.Range; }) {
		const result = new Map<string, vscode.CompletionItem>();

		for (let info of repos) {

			const milestones = await this._githubData.getOrFetchMilestones(info);
			for (let milestone of milestones) {
				if (milestone.state === 'closed') {
					continue;
				}
				let existing = result.get(milestone.title);
				if (existing) {
					existing.documentation = undefined;
					existing.sortText = String.fromCharCode(0) + existing.sortText;
				} else {
					result.set(milestone.title, {
						label: { label: milestone.title, description: milestone.description },
						range,
						kind: vscode.CompletionItemKind.Event,
						insertText: milestone.title.match(/\s/) ? `"${milestone.title}"` : undefined,
						filterText: milestone.title.match(/\s/) ? `"${milestone.title}"` : undefined,
						sortText: milestone.due_on,
					});
				}
			}
		}
		return [...result.values()];
	}

	private async _completeUsernames(repos: Iterable<RepoInfo>, range?: { inserting: vscode.Range, replacing: vscode.Range; }) {
		const result = new Map<string, vscode.CompletionItem>();
		for (let info of repos) {
			for (let user of await this._githubData.getOrFetchUsers(info)) {
				if (!result.has(user.login)) {
					result.set(user.login, {
						label: user.login,
						kind: vscode.CompletionItemKind.User,
						range
					});
				}
			}
		}
		return [...result.values()];
	}
}

export abstract class IProjectValidation {

	protected readonly _collections = new Map<Project, vscode.DiagnosticCollection>();

	abstract validateProject(project: Project, token: vscode.CancellationToken): void;

	clearProject(project: Project) {
		let collection = this._collections.get(project);
		if (collection) {
			collection.dispose();
			this._collections.delete(project);
		}
	}
}

class LanguageValidationDiagnostic extends vscode.Diagnostic {

	private static asMessage(error: ValidationError): string {
		switch (error.code) {
			case Code.NodeMissing: return vscode.l10n.t('Expected {0}', error.expected.join(', '));
			case Code.OrNotAllowed: return vscode.l10n.t('OR is not supported when defining a variable');
			case Code.VariableDefinedRecursive: return vscode.l10n.t('Cannot reference a variable from its definition');
			case Code.VariableUnknown: return vscode.l10n.t(`Unknown variable`);
			case Code.QualifierUnknown: return vscode.l10n.t('Unknown qualifier: \'{0}\'', error.node.value);
			case Code.ValueConflict: return vscode.l10n.t('This conflicts with another usage');
			case Code.ValueTypeUnknown: return vscode.l10n.t('Unknown value \'{0}\', expected type \'{1}\'', error.actual, error.expected);
			case Code.ValueUnknown: return vscode.l10n.t('Unknown value \'{0}\', expected one of \'{1}\'', error.actual, Array.from(error.expected).map(set => [...set.entries]).flat().join(', '));
			case Code.SequenceNotAllowed: return vscode.l10n.t(`Sequence of values is not allowed`);
			case Code.RangeMixesTypes: return vscode.l10n.t('This range uses mixed values: {0} and {1}`', error.valueA!, error.valueB!);
		}
	}

	readonly docVersion: number;

	constructor(readonly error: ValidationError, project: Project, doc: vscode.TextDocument) {
		super(project.rangeOf(error.node), LanguageValidationDiagnostic.asMessage(error));

		this.code = error.code;
		this.docVersion = doc.version;

		if (error.code === Code.ValueConflict && error.conflictNode) {
			this.relatedInformation = [new vscode.DiagnosticRelatedInformation(
				new vscode.Location(doc.uri, project.rangeOf(error.conflictNode)),
				project.textOf(error.conflictNode)
			)];
			this.tags = [vscode.DiagnosticTag.Unnecessary];
		}

		if (error.code === Code.NodeMissing && error.hint) {
			this.severity = vscode.DiagnosticSeverity.Information;
		}
	}
}

export class LanguageValidation extends IProjectValidation {


	validateProject(project: Project) {

		let collection = this._collections.get(project);
		if (!collection) {
			collection = vscode.languages.createDiagnosticCollection();
			this._collections.set(project, collection);
		} else {
			collection.clear();
		}

		for (let { node, doc } of project.all()) {
			const newDiagnostics: vscode.Diagnostic[] = [];
			for (let error of validateQueryDocument(node, project.symbols)) {
				newDiagnostics.push(new LanguageValidationDiagnostic(error, project, doc));
			}
			collection.set(doc.uri, newDiagnostics);
		}
	}
}

export class GithubValidation extends IProjectValidation {

	constructor(readonly githubData: GithubData, readonly octokit: OctokitProvider) {
		super();
	}

	validateProject(project: Project, token: vscode.CancellationToken) {

		let collection = this._collections.get(project);
		if (!collection) {
			collection = vscode.languages.createDiagnosticCollection();
			this._collections.set(project, collection);
		} else {
			collection.clear();
		}

		const repos = Array.from(getAllRepos(project));
		if (repos.length === 0) {
			return;
		}

		for (let { node: queryDoc, doc } of project.all()) {
			const newDiagnostics: vscode.Diagnostic[] = [];
			const work: Promise<any>[] = [];
			Utils.walk(queryDoc, async (node, parent) => {
				if (parent?._type !== NodeType.Query || node._type !== NodeType.QualifiedValue || node.value._type === NodeType.Missing) {
					return;
				}

				const info = QualifiedValueNodeSchema.get(node.qualifier.value);

				const validateValue = async (valueNode: Utils.PrintableNode) => {

					const value = Utils.print(valueNode, queryDoc.text, name => project.symbols.getFirst(name)?.value).replace(/^"(.*)"$/, '$1');

					if (info?.placeholderType === ValuePlaceholderType.Label) {
						work.push(this._checkLabels(value, repos).then(missing => {
							if (missing.length === repos.length) {
								const diag = new vscode.Diagnostic(project.rangeOf(valueNode), vscode.l10n.t("Label '{0}' is unknown", value), vscode.DiagnosticSeverity.Warning);
								newDiagnostics.push(diag);
							} else if (missing.length > 0) {
								const diag = new vscode.Diagnostic(project.rangeOf(valueNode), vscode.l10n.t("Label '{0}' is unknown in these repositories: {1}", value, missing.map(info => `${info.owner}/${info.repo}`).join(', ')), vscode.DiagnosticSeverity.Hint);
								newDiagnostics.push(diag);
							}
						}));

					} else if (info?.placeholderType === ValuePlaceholderType.Milestone) {
						work.push(this._checkMilestones(value, repos).then(missing => {
							if (missing.length === repos.length) {
								const diag = new vscode.Diagnostic(project.rangeOf(valueNode), vscode.l10n.t("Milestone '{0}' is unknown", value), vscode.DiagnosticSeverity.Warning);
								newDiagnostics.push(diag);
							} else if (missing.length > 0) {
								const diag = new vscode.Diagnostic(project.rangeOf(valueNode), vscode.l10n.t("Milestone '{0}' is unknown in these repositories: {1}", value, missing.map(info => `${info.owner}/${info.repo}`).join(', ')), vscode.DiagnosticSeverity.Hint);
								newDiagnostics.push(diag);
							}
						}));

					} else if (info?.placeholderType === ValuePlaceholderType.Username) {
						if (value === '@me') {
							work.push(this.octokit.lib().then(() => {
								if (!this.octokit.isAuthenticated) {
									const diag = new vscode.Diagnostic(project.rangeOf(valueNode), vscode.l10n.t('{0} requires that you are logged in', '@me'), vscode.DiagnosticSeverity.Warning);
									diag.code = Code.GitHubLoginNeeded;
									newDiagnostics.push(diag);
								}
							}));
						}
					}
				};

				if (node.value._type === NodeType.LiteralSequence) {
					node.value.nodes.forEach(validateValue);
				} else {
					validateValue(node.value);
				}
			});

			Promise.all(work).then(() => {
				if (token.isCancellationRequested) {
					return;
				}
				let collection = this._collections.get(project);
				if (collection && project.has(doc)) {
					// project or document might have been dismissed already
					collection.set(doc.uri, newDiagnostics);
				}
			});
		}
	}

	private async _checkLabels(label: string, repos: RepoInfo[]) {
		let result: RepoInfo[] = [];
		for (const info of repos) {
			const labels = await this.githubData.getOrFetchLabels(info);
			const found = labels.find(info => info.name === label);
			if (!found) {
				result.push(info);
			}
		}
		return result;
	}

	private async _checkMilestones(milestone: string, repos: RepoInfo[]) {
		let result: RepoInfo[] = [];
		for (let info of repos) {
			const labels = await this.githubData.getOrFetchMilestones(info);
			const found = labels.find(info => info.title === milestone);
			if (!found) {
				result.push(info);
			}
		}
		return result;
	}
}

export class Validation {

	private _disposables: vscode.Disposable[] = [];

	constructor(
		readonly container: ProjectContainer,
		readonly octokit: OctokitProvider,
		readonly validation: IProjectValidation[]
	) {


		let cts = new vscode.CancellationTokenSource();
		function validateAllSoon(delay = 300) {
			cts.cancel();
			cts = new vscode.CancellationTokenSource();
			let handle = setTimeout(() => {
				for (let project of container.all()) {
					for (let strategy of validation) {
						strategy.validateProject(project, cts.token);
					}
				}
			}, delay);
			cts.token.onCancellationRequested(() => clearTimeout(handle));
		}
		validateAllSoon();
		this._disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
			if (vscode.languages.match(selector, e.document)) {
				validateAllSoon(500);
			}
		}));
		this._disposables.push(vscode.authentication.onDidChangeSessions(e => {
			if (e.provider.id === 'github') {
				validateAllSoon();
			}
		}));
		this._disposables.push(container.onDidChange(() => {
			validateAllSoon();
		}));
		this._disposables.push(container.onDidRemove(project => {
			for (let strategy of validation) {
				strategy.clearProject(project);
			}
		}));
		this._disposables.push(octokit.onDidChange(() => {
			validateAllSoon();
		}));
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}

export function registerLanguageProvider(container: ProjectContainer, octokit: OctokitProvider): vscode.Disposable {

	const disposables: vscode.Disposable[] = [];
	const githubData = new GithubData(octokit);

	vscode.languages.setLanguageConfiguration(selector.language, {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
		comments: { lineComment: '//' }
	});

	disposables.push(vscode.languages.registerHoverProvider(selector, new HoverProvider(container)));
	disposables.push(vscode.languages.registerSelectionRangeProvider(selector, new SelectionRangeProvider(container)));
	disposables.push(vscode.languages.registerDocumentHighlightProvider(selector, new DocumentHighlightProvider(container)));
	disposables.push(vscode.languages.registerDefinitionProvider(selector, new DefinitionProvider(container)));
	disposables.push(vscode.languages.registerReferenceProvider(selector, new ReferenceProvider(container)));
	disposables.push(vscode.languages.registerRenameProvider(selector, new RenameProvider(container)));
	disposables.push(vscode.languages.registerCodeActionsProvider(selector, new QuickFixProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
	disposables.push(vscode.languages.registerCodeActionsProvider(selector, new ExtractVariableProvider(container), { providedCodeActionKinds: [vscode.CodeActionKind.RefactorExtract] }));
	disposables.push(vscode.languages.registerCodeActionsProvider({ ...selector, scheme: 'vscode-notebook-cell' }, new NotebookSplitOrIntoCellProvider(container), { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] }));
	disposables.push(vscode.languages.registerCodeActionsProvider({ ...selector, scheme: 'vscode-notebook-cell' }, new NotebookExtractCellProvider(container), { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] }));
	disposables.push(vscode.languages.registerCodeActionsProvider({ notebookType: 'github-issues' }, new VariableNamesSourceAction(container), { providedCodeActionKinds: [VariableNamesSourceAction.kind] }));
	disposables.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, new DocumentSemanticTokensProvider(container), DocumentSemanticTokensProvider.legend));
	disposables.push(vscode.languages.registerDocumentRangeFormattingEditProvider(selector, new FormattingProvider(container)));
	disposables.push(vscode.languages.registerOnTypeFormattingEditProvider(selector, new FormattingProvider(container), '\n'));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new CompletionItemProvider(container), ...CompletionItemProvider.triggerCharacters));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new GithubOrgCompletions(container, octokit), ...GithubOrgCompletions.triggerCharacters));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new GithubRepoSearchCompletions(container, octokit), ...GithubRepoSearchCompletions.triggerCharacters));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new GithubPlaceholderCompletions(container, githubData), ...GithubPlaceholderCompletions.triggerCharacters));

	disposables.push(new Validation(container, octokit, [
		new LanguageValidation(),
		new GithubValidation(githubData, octokit)
	]));

	return vscode.Disposable.from(...disposables);
}
