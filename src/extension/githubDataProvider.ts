/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OctokitProvider } from "./octokitProvider";
import { RepoInfo } from "./utils";

export type LabelInfo = {
	color: string;
	name: string;
	description: string;
};

export type MilestoneInfo = {
	title: string;
	state: string;
	description: string;
	open_issues: number;
	closed_issues: number;
	closed_at: string;
	due_on: string;
};

export type UserInfo = {
	login: string;
};


export class GithubData {

	private readonly _cache = new Map<string, Promise<any[]>>();

	constructor(readonly octokitProvider: OctokitProvider) { }

	private _getOrFetch<T>(type: string, info: RepoInfo, fetch: () => Promise<T[]>) {
		const key = type + info.owner + info.repo;
		let result = this._cache.get(key);
		if (!result) {
			result = fetch();
			this._cache.set(key, result);
		}
		return result;
	}

	async getOrFetchLabels(info: RepoInfo): Promise<LabelInfo[]> {
		return this._getOrFetch<LabelInfo>('labels', info, async () => {
			const octokit = await this.octokitProvider.lib();
			const options = octokit.issues.listLabelsForRepo.endpoint.merge({ ...info });
			return octokit.paginate<LabelInfo>((<any>options));
		});
	}

	async getOrFetchMilestones(info: RepoInfo): Promise<MilestoneInfo[]> {
		return this._getOrFetch<MilestoneInfo>('milestone', info, async () => {
			const octokit = await this.octokitProvider.lib();
			const options = octokit.issues.listMilestones.endpoint.merge({ ...info, state: 'all', sort: 'due_on' });
			return octokit.paginate<MilestoneInfo>((<any>options));
		});
	}

	async getOrFetchUsers(info: RepoInfo): Promise<UserInfo[]> {
		return this._getOrFetch<UserInfo>('user', info, async () => {
			const octokit = await this.octokitProvider.lib();
			const options = octokit.repos.listContributors.endpoint.merge({ ...info });
			return octokit.paginate<UserInfo>((<any>options));
		});
	}
}
