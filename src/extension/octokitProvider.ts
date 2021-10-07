/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Octokit } from '@octokit/rest';
import * as vscode from 'vscode';

export class OctokitProvider {

	private readonly _onDidChange = new vscode.EventEmitter<this>();
	readonly onDidChange = this._onDidChange.event;

	private _octokit = new Octokit();
	private _isAuthenticated = false;

	async lib(createIfNone?: boolean) {
		const oldIsAuth = this._isAuthenticated;
		try {
			const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone });
			if (session) {
				this._octokit = new Octokit({ auth: session.accessToken });
				this._isAuthenticated = true;
			}
		} catch (err) {
			this._isAuthenticated = false;
			// no token
			console.warn('FAILED TO AUTHENTICATE');
			console.warn(err);
		}

		if (oldIsAuth !== this._isAuthenticated) {
			this._onDidChange.fire(this);
		}

		return this._octokit;
	}

	get isAuthenticated() {
		return this._isAuthenticated;
	}
}
