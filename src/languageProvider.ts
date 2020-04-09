/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, NodeType, Utils } from './parser/nodes';
import { validateQueryDocument } from './parser/validation';
import { SortByNodeSchema, QualifiedValueNodeSchema, ValuePlaceholderType } from './parser/symbols';
import { ProjectContainer } from './project';
import { Scanner, TokenType, Token } from './parser/scanner';
import { OctokitProvider } from './octokitProvider';
import { getRepoInfos, RepoInfo } from './utils';
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
			if (node._type === NodeType.SortBy) {
				token = node.keyword;
			}
			if (token) {
				const { line, character } = document.positionAt(token.start);
				builder.push(line, character, token.end - token.start, 0);
			}
		});
		return builder.build();
	}
}

export class Validation {

	private _disposables: vscode.Disposable[] = [];

	constructor(container: ProjectContainer) {

		// Validation
		const diagCollection = vscode.languages.createDiagnosticCollection();
		async function validateAll() {
			// add all
			for (let project of container.all()) {
				for (let { node, doc } of project.all()) {
					const newDiagnostics: vscode.Diagnostic[] = [];
					for (let error of validateQueryDocument(node, project.symbols)) {
						const diag = new vscode.Diagnostic(project.rangeOf(error.node), error.message);
						if (error.conflictNode) {
							diag.relatedInformation = [new vscode.DiagnosticRelatedInformation(
								new vscode.Location(doc.uri, project.rangeOf(error.conflictNode)),
								project.textOf(error.conflictNode)
							)];
							diag.tags = [vscode.DiagnosticTag.Unnecessary];
						}
						newDiagnostics.push(diag);
					}
					diagCollection.set(doc.uri, newDiagnostics);
				}
			}
		}
		let handle: NodeJS.Timeout;
		function validateAllSoon() {
			clearTimeout(handle);
			handle = setTimeout(() => validateAll(), 500);
		}
		validateAllSoon();
		this._disposables.push(vscode.workspace.onDidChangeTextDocument(() => validateAllSoon()));
		this._disposables.push(vscode.workspace.onDidOpenTextDocument(doc => {
			if (vscode.languages.match(selector, doc)) {
				// add new document to project, then validate
				container.lookupProject(doc.uri).getOrCreate(doc);
				validateAllSoon();
			}
		}));
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
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

		if (parent?._type === NodeType.SortBy) {
			// complete the sortby statement
			return [...SortByNodeSchema].map(value => new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
		}

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

		if (node?._type === NodeType.Query || node._type === NodeType.Literal) {
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
					detail: symbol.type,
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

export class GithubOrgCompletions implements vscode.CompletionItemProvider {

	static readonly triggerCharacters = [':'];

	constructor(readonly container: ProjectContainer, readonly octokitProvider: OctokitProvider) { }

	async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
		if (!this.octokitProvider.isAuthenticated) {
			return;
		}

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
		if (!info || info.placeholderType === undefined) {
			return;
		}

		if (info.placeholderType !== ValuePlaceholderType.Orgname) {
			return;
		}

		type OrgInfo = { login: string; };
		const octokit = await this.octokitProvider.lib();
		const user = await octokit.users.getAuthenticated();
		const options = octokit.orgs.listForUser.endpoint.merge({ username: user.data.login, });
		return octokit.paginate<OrgInfo>(<any>options).then(values => values.map(value => new vscode.CompletionItem(value.login)));
	}
}

export class GithubPlaceholderCompletions implements vscode.CompletionItemProvider {

	static readonly triggerCharacters = [':'];

	private readonly _githubData: GithubData;

	constructor(readonly container: ProjectContainer, readonly octokitProvider: OctokitProvider) {
		this._githubData = new GithubData(octokitProvider);
	}

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

		const repos = getRepoInfos(doc, project);
		const info = QualifiedValueNodeSchema.get(qualified.qualifier.value);

		const inserting = new vscode.Range(document.positionAt(qualified.value.start), position);
		const replacing = new vscode.Range(document.positionAt(qualified.value.start), document.positionAt(qualified.value.end));
		const range = inserting.isEmpty || replacing ? undefined : { inserting, replacing };

		if (info?.placeholderType === ValuePlaceholderType.Label) {
			return this._completeLabels(repos, range);
		} else if (info?.placeholderType === ValuePlaceholderType.Milestone) {
			return this._completeMilestones(repos, range);
		} else if (info?.placeholderType === ValuePlaceholderType.Username) {
			return this._completeUsernames(repos, range);
		}
	}

	private async _completeLabels(repos: Iterable<RepoInfo>, range?: { inserting: vscode.Range, replacing: vscode.Range; }) {
		const results: Map<string, vscode.CompletionItem>[] = [];
		for (let info of repos) {
			const map = new Map<string, vscode.CompletionItem>();
			results.push(map);

			const labels = await this._githubData.getOrFetchLabels(info);
			for (const label of labels) {
				map.set(label.name, {
					label: label.name,
					range,
					detail: label.description,
					kind: vscode.CompletionItemKind.Color,
					documentation: `#${label.color}`
				});
			}
		}

		if (results.length === 0) {
			// nothing
			return [];
		} else if (results.length === 1) {
			// labels from repo
			return [...results[0].values()];
		} else {
			// intersection of all labels
			let result: vscode.CompletionItem[] = [];
			let [first, ...rest] = results;
			for (let [key, value] of first) {
				if (rest.every(map => map.has(key))) {
					result.push({
						label: value.label,
						kind: vscode.CompletionItemKind.Constant
					});
				}
			}
			return result;
		}
	}

	private async _completeMilestones(repos: Iterable<RepoInfo>, range?: { inserting: vscode.Range, replacing: vscode.Range; }) {
		const results: vscode.CompletionItem[][] = [];
		for (let info of repos) {

			const milestones = await this._githubData.getOrFetchMilestones(info);

			results.push(milestones.map(milestone => {
				return {
					label: milestone.title,
					range,
					documentation: milestone.description,
					kind: vscode.CompletionItemKind.Event,
					insertText: milestone.title.match(/\s/) ? `"${milestone.title}"` : undefined
				};
			}));
		}
		// todo@jrieken how to merge milestones? by label? by dates? never?
		return results.length === 1 ? results[0] : undefined;
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

export function registerLanguageProvider(container: ProjectContainer, octokit: OctokitProvider): vscode.Disposable {

	const disposables: vscode.Disposable[] = [];

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
	disposables.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, new DocumentSemanticTokensProvider(container), DocumentSemanticTokensProvider.legend));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new CompletionItemProvider(container), ...CompletionItemProvider.triggerCharacters));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new GithubOrgCompletions(container, octokit), ...CompletionItemProvider.triggerCharacters));
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new GithubPlaceholderCompletions(container, octokit), ...CompletionItemProvider.triggerCharacters));

	disposables.push(new Validation(container));

	return vscode.Disposable.from(...disposables);
}
