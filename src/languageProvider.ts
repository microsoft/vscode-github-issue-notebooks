/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, NodeType, Utils, QueryDocumentNode } from './parser/nodes';
import { validateQueryDocument, ValidationError, Code } from './parser/validation';
import { QualifiedValueNodeSchema, ValuePlaceholderType } from './parser/symbols';
import { ProjectContainer, Project } from './project';
import { Scanner, TokenType, Token } from './parser/scanner';
import { OctokitProvider } from './octokitProvider';
import { getRepoInfos, RepoInfo, isRunnable } from './utils';
import { GithubData } from './githubDataProvider';

const selector = { language: 'github-issues' };

export class HoverProvider implements vscode.HoverProvider {

	constructor(readonly container: ProjectContainer) { }

	async provideHover(document: vscode.TextDocument, position: vscode.Position) {
		const offset = document.offsetAt(position);
		const project = this.container.lookupProject(document.uri);
		const query = project.getOrCreate(document);
		const node = Utils.nodeAt(query, offset);

		if (node?._type === NodeType.VariableName) {
			const info = project.symbols.getFirst(node.value);
			return new vscode.Hover(`\`${info?.value}\`${info?.type ? ` (${info.type})` : ''}`, project.rangeOf(node));
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
			const uri = vscode.Uri.parse(symbol.root.id);
			result.push(new vscode.Location(uri, project.rangeOf(symbol.def, uri)));
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

		if (parent?._type === NodeType.QualifiedValue && node === parent.value) {
			// RHS of a qualified value => complete value set
			const result: vscode.CompletionItem[] = [];
			const info = QualifiedValueNodeSchema.get(parent.qualifier.value);
			if (info?.enumValues) {
				for (let set of info.enumValues) {
					for (let value of set.entries) {
						result.push(new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
					}
				}
			}
			return result;
		}

		if (node?._type === NodeType.Query || node._type === NodeType.Literal || node._type === NodeType.VariableName) {
			const result: vscode.CompletionItem[] = [];

			// names of qualified value node
			for (let [key] of QualifiedValueNodeSchema) {
				result.push({
					label: key,
					kind: vscode.CompletionItemKind.Enum
				});
			}

			// all variables
			for (let symbol of project.symbols.all()) {
				result.push({
					label: symbol.name,
					detail: symbol.type ? `${symbol.value} (${symbol.type})` : symbol.value,
					kind: vscode.CompletionItemKind.Value,
				});
			}

			// sort by for query
			if (node._type !== NodeType.Query || !node.sortby) {
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
	}
}

export class QuickFixProvider implements vscode.CodeActionProvider {

	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext) {
		const result: vscode.CodeAction[] = [];
		for (let diag of context.diagnostics) {
			if (diag instanceof LanguageValidationDiagnostic && document.version === diag.docVersion && diag.code === Code.ValueConflict) {
				const action = new vscode.CodeAction('Remove This', vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diag];
				action.edit = new vscode.WorkspaceEdit();
				action.edit.delete(document.uri, diag.range);
				result.push(action);
			}
		}
		return result;
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
			type RepoInfo = { full_name: string; };
			const response = await octokit.repos.listForAuthenticatedUser({ per_page: 100, sort: 'pushed', affiliation: 'owner,collaborator' });
			return (<RepoInfo[]>response.data).map(value => ({ label: value.full_name, range }));
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
				description: item.description,
				range,
			};
		});

		const incomplete = repos.data.total_count > repos.data.items.length;
		const result = new vscode.CompletionList(items, incomplete);
		return result;
	}
}

export class GithubPlaceholderCompletions implements vscode.CompletionItemProvider {

	static readonly triggerCharacters = [':'];

	constructor(
		readonly container: ProjectContainer,
		private readonly _githubData: GithubData
	) { }

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

		const repos = getRepoInfos(doc, project, query);
		const info = QualifiedValueNodeSchema.get(qualified.qualifier.value);

		const inserting = new vscode.Range(document.positionAt(qualified.value.start), position);
		const replacing = new vscode.Range(document.positionAt(qualified.value.start), document.positionAt(qualified.value.end));
		const range = { inserting, replacing };

		if (info?.placeholderType === ValuePlaceholderType.Label) {
			return this._completeLabels(repos, range);
		} else if (info?.placeholderType === ValuePlaceholderType.Milestone) {
			return this._completeMilestones(repos, range);
		} else if (info?.placeholderType === ValuePlaceholderType.Username) {
			return this._completeUsernames(repos, range);
		}
	}

	private async _completeLabels(repos: Iterable<RepoInfo>, range?: { inserting: vscode.Range, replacing: vscode.Range; }) {
		const result = new Map<string, vscode.CompletionItem>();

		for (let info of repos) {

			const labels = await this._githubData.getOrFetchLabels(info);
			for (const label of labels) {

				let existing = result.get(label.name);
				if (existing) {
					existing.detail = undefined;
					existing.kind = vscode.CompletionItemKind.Constant;
					existing.documentation = undefined;
					existing.sortText = String.fromCharCode(0) + existing.label;
				} else {
					result.set(label.name, {
						label: label.name,
						range,
						detail: label.description,
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
						label: milestone.title,
						range,
						documentation: milestone.description,
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

	readonly docVersion: number;

	constructor(readonly error: ValidationError, project: Project, doc: vscode.TextDocument) {
		super(project.rangeOf(error.node), error.message);

		this.code = error.code;
		this.docVersion = doc.version;

		if (error.conflictNode) {
			this.relatedInformation = [new vscode.DiagnosticRelatedInformation(
				new vscode.Location(doc.uri, project.rangeOf(error.conflictNode)),
				project.textOf(error.conflictNode)
			)];
			this.tags = [vscode.DiagnosticTag.Unnecessary];
		}

		if (error.hint) {
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

	constructor(readonly githubData: GithubData) {
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

		for (let { node: queryDoc, doc } of project.all()) {
			const newDiagnostics: vscode.Diagnostic[] = [];
			const work: Promise<any>[] = [];
			Utils.walk(queryDoc, async (node, parent) => {
				if (parent?._type !== NodeType.Query || node._type !== NodeType.QualifiedValue || node.value._type === NodeType.Missing) {
					return;
				}
				const repos = [...getRepoInfos(queryDoc, project, parent)];
				if (repos.length === 0) {
					return;
				}
				const value = Utils.print(node.value, queryDoc.text, name => project.symbols.getFirst(name)?.value).replace(/^"(.*)"$/, '$1');
				const info = QualifiedValueNodeSchema.get(node.qualifier.value);

				if (info?.placeholderType === ValuePlaceholderType.Label) {
					work.push(this._checkLabels(value, repos).then(missing => {
						if (missing.length === repos.length) {
							const diag = new vscode.Diagnostic(project.rangeOf(node.value), `Label '${value}' is unknown`, vscode.DiagnosticSeverity.Warning);
							newDiagnostics.push(diag);
						} else if (missing.length > 0) {
							const diag = new vscode.Diagnostic(project.rangeOf(node.value), `Label '${value}' is unknown in these repositories: ${missing.map(info => `${info.owner}/${info.repo}`).join(', ')}`, vscode.DiagnosticSeverity.Hint);
							newDiagnostics.push(diag);
						}
					}));

				} else if (info?.placeholderType === ValuePlaceholderType.Milestone) {
					work.push(this._checkMilestones(value, repos).then(missing => {
						if (missing.length === repos.length) {
							const diag = new vscode.Diagnostic(project.rangeOf(node.value), `Milestone '${value}' is unknown`, vscode.DiagnosticSeverity.Warning);
							newDiagnostics.push(diag);
						} else if (missing.length > 0) {
							const diag = new vscode.Diagnostic(project.rangeOf(node.value), `Milestone '${value}' is unknown in these repositories: ${missing.map(info => `${info.owner}/${info.repo}`).join(', ')}`, vscode.DiagnosticSeverity.Hint);
							newDiagnostics.push(diag);
						}
					}));
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
		this._disposables.push(container.onDidChange(() => {
			validateAllSoon();
		}));
		this._disposables.push(container.onDidRemove(project => {
			for (let strategy of validation) {
				strategy.clearProject(project);
			}
		}));
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}

export class RunnableState {

	private _disposables: vscode.Disposable[] = [];

	constructor(readonly container: ProjectContainer) {
		const update = (document: vscode.TextDocument) => {
			if (vscode.languages.match(selector, document)) {
				this._updateRunnableState(document);
			}
		};
		vscode.workspace.textDocuments.forEach(update);
		vscode.workspace.onDidChangeTextDocument(e => update(e.document), this, this._disposables);
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}

	private _updateRunnableState(document: vscode.TextDocument) {
		const project = this.container.lookupProject(document.uri, false);
		if (!project) {
			return;
		}
		const query = project.getOrCreate(document);
		if (!vscode.notebook.activeNotebookEditor) {
			return; // problem???
		}
		const cell = vscode.notebook.activeNotebookEditor.document.cells.find(cell => cell.uri.toString() === document.uri.toString());
		if (!cell) {
			return; // problem???
		}
		cell.metadata.runnable = isRunnable(query);
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
	disposables.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, new DocumentSemanticTokensProvider(container), DocumentSemanticTokensProvider.legend));
	disposables.push(vscode.languages.registerDocumentRangeFormattingEditProvider(selector, new FormattingProvider(container)));
	disposables.push(vscode.languages.registerOnTypeFormattingEditProvider(selector, new FormattingProvider(container), '\n'));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new CompletionItemProvider(container), ...CompletionItemProvider.triggerCharacters));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new GithubOrgCompletions(container, octokit), ...GithubOrgCompletions.triggerCharacters));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new GithubRepoSearchCompletions(container, octokit), ...GithubRepoSearchCompletions.triggerCharacters));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new GithubPlaceholderCompletions(container, githubData), ...GithubPlaceholderCompletions.triggerCharacters));

	disposables.push(new Validation(container, [
		new LanguageValidation(),
		new GithubValidation(githubData)
	]));

	disposables.push(new RunnableState(container));

	return vscode.Disposable.from(...disposables);
}
