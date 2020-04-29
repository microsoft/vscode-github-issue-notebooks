/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Octokit } from '@octokit/rest';
import * as vscode from 'vscode';

export class OctokitProvider {

	private _octokit = new Octokit();
	private _isAuthenticated = false;

	async lib() {
		try {
			const scopes = ['repo'];
			let [first] = await vscode.authentication.getSessions('github', scopes);
			if (!first) {
				first = await vscode.authentication.login('github', scopes);
			}
			const token = await first.getAccessToken();
			this._octokit = new Octokit({ auth: token });
			this._isAuthenticated = true;

		} catch (err) {
			// no token
			console.warn('FAILED TO AUTHENTICATE');
			console.warn(err);
		}
		return this._octokit;
	}

	get isAuthenticated() {
		return this._isAuthenticated;
	}
}
