export interface SearchIssuesAndPullRequestsResponseItemsItemUser {
	avatar_url: string;
	events_url: string;
	followers_url: string;
	following_url: string;
	gists_url: string;
	gravatar_id: string;
	html_url: string;
	id: number;
	login: string;
	node_id: string;
	organizations_url: string;
	received_events_url: string;
	repos_url: string;
	starred_url: string;
	subscriptions_url: string;
	type: string;
	url: string;
}

export interface SearchIssuesAndPullRequestsResponseItemsItemPullRequest {
	diff_url: null;
	html_url: null;
	patch_url: null;
}

export interface SearchIssuesAndPullRequestsResponseItemsItemLabelsItem {
	color: string;
	id: number;
	name: string;
	node_id: string;
	url: string;
}

export interface SearchIssuesAndPullRequestsResponseItemsItem {
	assignee: null | SearchIssuesAndPullRequestsResponseItemsItemUser;
	assignees: null | Array<SearchIssuesAndPullRequestsResponseItemsItemUser>;
	body: string;
	closed_at: null;
	comments: number;
	comments_url: string;
	created_at: string;
	events_url: string;
	html_url: string;
	id: number;
	labels: Array<SearchIssuesAndPullRequestsResponseItemsItemLabelsItem>;
	labels_url: string;
	milestone: null;
	node_id: string;
	number: number;
	pull_request: SearchIssuesAndPullRequestsResponseItemsItemPullRequest;
	repository_url: string;
	score: number;
	state: string;
	title: string;
	updated_at: string;
	url: string;
	user: SearchIssuesAndPullRequestsResponseItemsItemUser;
}
