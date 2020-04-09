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

	private _cache = new Map<string, Promise<vscode.CompletionItem[]>>();

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
		if (!info || info.placeholderType === undefined) {
			return;
		}

		const results = new Map<string, vscode.CompletionItem>();

		const insertRange = new vscode.Range(document.positionAt(qualified.value.start), position);
		const replaceRange = new vscode.Range(document.positionAt(qualified.value.start), document.positionAt(qualified.value.end));
		const range = insertRange.isEmpty || replaceRange ? undefined : { inserting: insertRange, replacing: replaceRange };

		for (const repo of getRepoInfos(doc, project)) {

			const items = await this._getOrFetch(repo, info.placeholderType);
			if (!items) {
				continue;
			}
			for (let item of items) {
				item.range = range;
				if (item.label.match(/\s/)) {
					item.insertText = `"${item.label}"`;
					item.filterText = `"${item.label}"`;
				}
				let existing = results.get(item.label);
				if (!existing) {
					results.set(item.label, item);
				}
			}
		}

		return [...results.values()];
	}

	private async _getOrFetch(info: RepoInfo, type: ValuePlaceholderType) {
		const key = `${type}:${info.owner}/${info.repo}`;
		if (!this._cache.has(key)) {
			if (type === ValuePlaceholderType.Label) {
				this._cache.set(key, this._labels(info));
			} else if (type === ValuePlaceholderType.Milestone) {
				this._cache.set(key, this._milestones(info));
			} else if (type === ValuePlaceholderType.Username) {
				this._cache.set(key, this._collaborators(info));
			}
		}
		if (this._cache.has(key)) {
			return await this._cache.get(key);
		}
	}

	private async _labels(info: RepoInfo): Promise<vscode.CompletionItem[]> {
		type LabelInfo = {
			color: string;
			name: string;
			description: string;
		};
		const octokit = await this.octokitProvider.lib();
		const options = octokit.issues.listLabelsForRepo.endpoint.merge(info);
		return octokit.paginate<LabelInfo>((<any>options)).then(labels => {
			return labels.map(label => {
				const item = new vscode.CompletionItem(label.name);
				item.detail = label.description;
				item.kind = vscode.CompletionItemKind.EnumMember;
				item.kind = vscode.CompletionItemKind.Color;
				item.documentation = '#' + label.color;
				return item;
			});
		});
	}

	private async _milestones(info: RepoInfo): Promise<vscode.CompletionItem[]> {
		type MilestoneInfo = {
			title: string;
			state: string;
			description: string;
			open_issues: number;
			closed_issues: number;
		};
		const octokit = await this.octokitProvider.lib();
		const options = octokit.issues.listMilestonesForRepo.endpoint.merge(info);
		return octokit.paginate<MilestoneInfo>((<any>options)).then(milestones => {
			return milestones.map(milestone => {
				const item = new vscode.CompletionItem(milestone.title);
				item.documentation = new vscode.MarkdownString(milestone.description);
				item.kind = vscode.CompletionItemKind.Event;
				item.insertText = milestone.title.match(/\s/) ? `"${milestone.title}"` : milestone.title;
				return item;
			});
		});
	}

	private async _collaborators(info: RepoInfo): Promise<vscode.CompletionItem[]> {
		type Info = { login: string; };
		const octokit = await this.octokitProvider.lib();
		const options = octokit.repos.listContributors.endpoint.merge(info);
		return octokit.paginate<Info>((<any>options)).then(labels => {
			return labels.map(user => {
				const item = new vscode.CompletionItem(user.login);
				item.kind = vscode.CompletionItemKind.User;
				return item;
			});
		});
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
