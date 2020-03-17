/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QueryDocumentProject } from './service';

interface RawNotebookCell {
    language: string;
    value: string;
    kind: vscode.CellKind;
}

export class IssuesNotebookProvider implements vscode.NotebookProvider {

    constructor(readonly project: QueryDocumentProject) { }

    async resolveNotebook(editor: vscode.NotebookEditor): Promise<void> {

        editor.document.languages = ['github-issues'];

        const contents = Buffer.from(await vscode.workspace.fs.readFile(editor.document.uri)).toString('utf8');
        let raw: RawNotebookCell[];
        try {
            raw = <RawNotebookCell[]>JSON.parse(contents);
        } catch {
            //?
            raw = [{ kind: vscode.CellKind.Code, language: 'github-issues', value: '' }];
        }
        editor.document.cells = raw.map(cell => editor.createCell(cell.value, cell.language, cell.kind, []));
    }

    async executeCell(_document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined): Promise<void> {
        if (!cell) {
            return;
        }
        const doc = await vscode.workspace.openTextDocument(cell.uri);
        const query = this.project.getOrCreate(doc);
        const lines = this.project.emit(query, doc.uri);

        cell.outputs = lines.map(line => ({
            outputKind: vscode.CellOutputKind.Text,
            text: line
        }));
    }

    async save(document: vscode.NotebookDocument): Promise<boolean> {
        let contents: RawNotebookCell[] = [];
        for (let cell of document.cells) {
            contents.push({
                kind: cell.cellKind,
                language: cell.language,
                value: cell.getContent()
            });
        }
        await vscode.workspace.fs.writeFile(document.uri, Buffer.from(JSON.stringify(contents)));
        return true;
    }
}
