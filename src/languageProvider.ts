/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, NodeType, Utils, QualifiedValueNode, QueryNode } from './parser/nodes';
import { validateQueryDocument } from './parser/validation';
import { SortByNodeSchema, QualifiedValueNodeSchema, ValuePlaceholderType } from './parser/symbols';
import { ProjectContainer } from './project';
import { Scanner, TokenType, Token } from './parser/scanner';
import { OctokitProvider } from './octokitProvider';
import { Parser } from './parser/parser';

const selector = { language: 'github-issues' };

export function registerLanguageProvider(container: ProjectContainer): vscode.Disposable {

	const disposables: vscode.Disposable[] = [];

	vscode.languages.setLanguageConfiguration(selector.language, {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
		comments: { lineComment: '//' }
	});

	// // Hover (debug, ast)
	// dispoables.push(vscode.languages.registerHoverProvider(selector, new class implements vscode.HoverProvider {
	// 	async provideHover(document: vscode.TextDocument, position: vscode.Position) {
	// 		const offset = document.offsetAt(position);
	// 		const project = container.lookupProject(document.uri);
	// 		const query = project.getOrCreate(document);
	// 		const stack: Node[] = [];
	// 		Utils.nodeAt(query, offset, stack);
	// 		stack.shift();

	// 		return new vscode.Hover(
	// 			stack.map(node => `- \`${project.textOf(node)}\` (*${node._type}*)\n`).join(''),
	// 			project.rangeOf(stack[stack.length - 1])
	// 		);
	// 	}
	// }));

	// Hover
	disposables.push(vscode.languages.registerHoverProvider(selector, new class implements vscode.HoverProvider {
		async provideHover(document: vscode.TextDocument, position: vscode.Position) {
			const offset = document.offsetAt(position);
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);
			const node = Utils.nodeAt(query, offset);

			if (node?._type === NodeType.VariableName) {
				const info = project.symbols.getFirst(node.value);
				return new vscode.Hover(`\`${info?.value}\`${info?.type ? ` (${info.type})` : ''}`, project.rangeOf(node));
			}

			return undefined;
		}
	}));

	// Smart Select
	disposables.push(vscode.languages.registerSelectionRangeProvider(selector, new class implements vscode.SelectionRangeProvider {
		async provideSelectionRanges(document: vscode.TextDocument, positions: vscode.Position[]) {
			const result: vscode.SelectionRange[] = [];
			const project = container.lookupProject(document.uri);
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
	}));

	// Completions
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new class implements vscode.CompletionItemProvider {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {
			const project = container.lookupProject(document.uri);
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
				if (info && Array.isArray(info.enumValues)) {
					for (let set of info.enumValues) {
						for (let value of set) {
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
	}, ':', '$'));

	// Definition
	disposables.push(vscode.languages.registerDefinitionProvider(selector, new class implements vscode.DefinitionProvider {
		async provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
			const project = container.lookupProject(document.uri);
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
	}));

	// References
	disposables.push(vscode.languages.registerReferenceProvider(selector, new class implements vscode.ReferenceProvider {
		provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext): vscode.ProviderResult<vscode.Location[]> {
			const project = container.lookupProject(document.uri);
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
	}));

	// Rename
	// todo@jrieken consolidate with find references?
	disposables.push(vscode.languages.registerRenameProvider(selector, new class implements vscode.RenameProvider {
		prepareRename(document: vscode.TextDocument, position: vscode.Position) {
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);
			const offset = document.offsetAt(position);
			const node = Utils.nodeAt(query, offset);
			if (node?._type !== NodeType.VariableName) {
				throw Error('Only variables names can be renamed');
			}
			return project.rangeOf(node, document.uri);
		}

		async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string) {
			const project = container.lookupProject(document.uri);
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
	}));

	// Document Highlights
	disposables.push(vscode.languages.registerDocumentHighlightProvider(selector, new class implements vscode.DocumentHighlightProvider {
		provideDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.DocumentHighlight[]> {
			const project = container.lookupProject(document.uri);
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
	}));

	// Semantic Tokens
	const legend = new vscode.SemanticTokensLegend(['keyword'], ['']);
	disposables.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, new class implements vscode.DocumentSemanticTokensProvider {

		provideDocumentSemanticTokens(document: vscode.TextDocument) {
			const builder = new vscode.SemanticTokensBuilder();
			const project = container.lookupProject(document.uri);
			const query = project.getOrCreate(document);

			const tokens: Token[] = [];

			Utils.walk(query, node => {
				if (node._type === NodeType.OrExpression) {
					tokens.push(node.or);
				}
				if (node._type === NodeType.SortBy) {
					tokens.push(node.keyword);
				}
			});

			for (let token of tokens.sort((a, b) => a.start - b.start)) {
				const { line, character } = document.positionAt(token.start);
				builder.push(line, character, token.end - token.start, 0, 0);
			}

			return new vscode.SemanticTokens(builder.build());
		}

	}, legend));

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
	disposables.push(vscode.workspace.onDidChangeTextDocument(() => validateAllSoon()));
	disposables.push(vscode.workspace.onDidOpenTextDocument(doc => {
		if (vscode.languages.match(selector, doc)) {
			// add new document to project, then validate
			container.lookupProject(doc.uri).getOrCreate(doc);
			validateAllSoon();
		}
	}));
	// dispoables.push(vscode.workspace.onDidCloseTextDocument(doc => {
	// 	diagnostcis.set(doc.uri, undefined);
	// }));

	return vscode.Disposable.from(...disposables);
}


export function registerGHBasedLanguageProvider(container: ProjectContainer, octokitProvider: OctokitProvider): vscode.Disposable {

	const disposables: vscode.Disposable[] = [];

	const ghCompletions = new class {

		private _cache = new Map<string, Promise<vscode.CompletionItem[]>>();

		async getOrFetch(owner: string, repo: string, type: ValuePlaceholderType, replaceRange: vscode.Range) {
			const key = `${type}:${owner}/${repo}`;
			if (!this._cache.has(key)) {
				if (type === ValuePlaceholderType.Label) {
					this._cache.set(key, this._labels(owner, repo));
				} else if (type === ValuePlaceholderType.Milestone) {
					this._cache.set(key, this._milestones(owner, repo));
				} else if (type === ValuePlaceholderType.Username) {
					this._cache.set(key, this._collaborators(owner, repo));
				}
			}
			if (this._cache.has(key)) {
				return (await this._cache.get(key)!).map(item => {
					item.range = !replaceRange.isEmpty ? replaceRange : undefined;
					if (item.label.match(/\s/)) {
						item.insertText = `"${item.label}"`;
						item.filterText = `"${item.label}"`;
					}
					return item;
				});
			}
		}

		private async _labels(owner: string, repo: string): Promise<vscode.CompletionItem[]> {
			type LabelInfo = {
				color: string;
				name: string;
				description: string;
			};
			const octokit = await octokitProvider.lib();
			const options = octokit.issues.listLabelsForRepo.endpoint.merge({ owner, repo });
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

		private async _milestones(owner: string, repo: string): Promise<vscode.CompletionItem[]> {
			type MilestoneInfo = {
				title: string;
				state: string;
				description: string;
				open_issues: number;
				closed_issues: number;
			};
			const octokit = await octokitProvider.lib();
			const options = octokit.issues.listMilestonesForRepo.endpoint.merge({ owner, repo });
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

		private async _collaborators(owner: string, repo: string): Promise<vscode.CompletionItem[]> {
			type Info = {
				login: string;
			};
			const octokit = await octokitProvider.lib();
			const options = octokit.repos.listContributors.endpoint.merge({ owner, repo });
			return octokit.paginate<Info>((<any>options)).then(labels => {
				return labels.map(user => {
					const item = new vscode.CompletionItem(user.login);
					item.kind = vscode.CompletionItemKind.User;
					return item;
				});
			});
		}
	};

	// Completions - GH based
	disposables.push(vscode.languages.registerCompletionItemProvider(selector, new class implements vscode.CompletionItemProvider {

		async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {

			const project = container.lookupProject(document.uri);
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

			if (info.placeholderType === ValuePlaceholderType.Orgname) {
				return this._getOrFetchOrgCompletions();
			}

			if (info.placeholderType === ValuePlaceholderType.Repository) {
				return this._getOrFetchRepoCompletions();
			}

			const value = Utils.print(query, doc.text, name => project.symbols.getFirst(name)?.value);
			const resolvedQuery = <QueryNode>new Parser().parse(value).nodes[0];
			const repoNode = <QualifiedValueNode>resolvedQuery.nodes.find(child => child._type === NodeType.QualifiedValue && child.qualifier.value === 'repo');
			const repoValue = repoNode && value.substring(repoNode.value.start, repoNode.value.end);
			const idx = repoValue?.indexOf('/') ?? -1;
			if (!repoValue || idx < 0) {
				return;
			}
			return ghCompletions.getOrFetch(
				repoValue.substring(0, idx),
				repoValue.substring(idx + 1),
				info.placeholderType,
				new vscode.Range(document.positionAt(qualified.value.start), document.positionAt(qualified.value.end))
			);
		}


		private _orgCompletions?: Promise<vscode.CompletionItem[]>;
		private _repoCompletions?: Promise<vscode.CompletionItem[]>;

		async _getOrFetchOrgCompletions(): Promise<vscode.CompletionItem[]> {
			if (!this._orgCompletions) {
				type OrgInfo = { login: string; };
				const octokit = await octokitProvider.lib();
				const user = await octokit.users.getAuthenticated();
				const options = octokit.orgs.listForUser.endpoint.merge({ username: user.data.login, });
				this._orgCompletions = octokit.paginate<OrgInfo>(<any>options).then(values => values.map(value => new vscode.CompletionItem(value.login)));
			}
			return this._orgCompletions;
		}

		async _getOrFetchRepoCompletions(): Promise<vscode.CompletionItem[]> {
			if (!this._repoCompletions) {

				this._repoCompletions = (async () => {

					const result: vscode.CompletionItem[] = [];
					const octokit = await octokitProvider.lib();

					// USER repos
					type RepoInfo = {
						name: string;
						full_name: string;
						html_url: string;
					};
					let p1 = octokit.paginate<RepoInfo>(<any>octokit.repos.listForAuthenticatedUser.endpoint.merge()).then(values => {
						for (let value of values) {
							let item = new vscode.CompletionItem(value.full_name, vscode.CompletionItemKind.Folder);
							item.documentation = new vscode.MarkdownString(value.html_url);
							result.push(item);
						}
					});

					// ORG repos
					type OrgInfo = {
						login: string;
					};
					let p2 = octokit.paginate<OrgInfo>(<any>octokit.orgs.listForUser.endpoint.merge({ username: (await octokit.users.getAuthenticated()).data.login, })).then(async values => {
						for (let org of values) {
							const resp = await octokit.repos.listForOrg({
								org: org.login,
								sort: 'pushed'
							});
							for (let value of resp.data) {
								let item = new vscode.CompletionItem(value.full_name, vscode.CompletionItemKind.Folder);
								item.documentation = new vscode.MarkdownString(value.html_url);
								result.push(item);
							}
						}
					});

					await Promise.all([p1, p2]);
					return result;
				})();
			}
			return this._repoCompletions;
		}

	}, ':'));

	return vscode.Disposable.from(...disposables);
}
