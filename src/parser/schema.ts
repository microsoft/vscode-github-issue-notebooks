/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum ValueType {
    Number,
    Date,
    BaseBranch,
    HeadBranch,
    Label,
    Language,
    Milestone,
    Orgname,
    ProjectBoard,
    Repository,
    Teamname,
    Username,
}

export type Value = ValueType | Set<string>[];

export const qualifiers = new Map<string, Value>([
    ['type', [new Set(['pr', 'issue'])]],
    ['updated', ValueType.Date],
    ['in', [new Set(['title', 'body', 'comments'])]],
    ['org', ValueType.Orgname],
    ['repo', ValueType.Repository],
    ['user', ValueType.Username],
    ['state', [new Set(['open', 'closed'])]],
    ['assignee', ValueType.Username],
    ['author', ValueType.Username],
    ['mentions', ValueType.Username],
    ['team', ValueType.Teamname],
    ['commenter', ValueType.Username],
    ['involves', ValueType.Username],
    ['label', ValueType.Label],
    ['linked', [new Set(['pr', 'issue'])]],
    ['milestone', ValueType.Milestone],
    ['project', ValueType.ProjectBoard],
    ['language', ValueType.Language],
    ['comments', ValueType.Number],
    ['interactions', ValueType.Number],
    ['reactions', ValueType.Number],
    ['created', ValueType.Date],
    ['closed', ValueType.Date],
    ['archived', [new Set(['true', 'false'])]],
    ['is', [new Set(['locked', 'unlocked']), new Set(['merged', 'unmerged']), new Set(['public', 'private']), new Set(['open', 'closed']), new Set(['pr', 'issue'])]],
    ['no', [new Set(['label', 'milestone', 'assignee', 'project'])]],
    ['status', [new Set(['pending', 'success', 'failure'])]],
    ['base', ValueType.BaseBranch],
    ['head', ValueType.HeadBranch],
    ['draft', [new Set(['true', 'false'])]],
    ['review-requested', ValueType.Username],
    ['review', [new Set(['none', 'required', 'approved'])]],
    ['reviewed-by', ValueType.Username],
    ['team-review-requested', ValueType.Teamname],
    ['merged', ValueType.Date],
]);

export const requiresPrType = new Set<string>([
    'status',
    'base',
    'head',
    'draft',
    'review-requested',
    'review',
    'reviewed-by',
    'team-review-requested',
    'merged',
]);
