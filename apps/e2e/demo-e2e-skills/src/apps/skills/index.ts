import { App } from '@frontmcp/sdk';

import { DevOpsPlugin } from './plugins/devops-plugin';
import {
  AdminGatedSkill,
  DeploySkill,
  DocsSkill,
  FullPRWorkflowSkill,
  HiddenSkill,
  HttpOnlySkill,
  McpOnlySkill,
  NotifyTeamSkill,
  ReviewPRSkill,
} from './skills';
import { AdminActionTool } from './tools/admin-action.tool';
import { GitHubAddCommentTool } from './tools/github-add-comment.tool';
import { GitHubGetPRTool } from './tools/github-get-pr.tool';
import { SlackNotifyTool } from './tools/slack-notify.tool';

@App({
  name: 'skills-e2e',
  tools: [GitHubGetPRTool, GitHubAddCommentTool, SlackNotifyTool, AdminActionTool],
  skills: [
    ReviewPRSkill,
    NotifyTeamSkill,
    HiddenSkill,
    DeploySkill,
    FullPRWorkflowSkill,
    McpOnlySkill,
    HttpOnlySkill,
    DocsSkill,
  ],
  plugins: [DevOpsPlugin],
})
export class SkillsE2EApp {}

/**
 * Variant app that additionally registers an authority-gated skill
 * (`admin-gated`). Used only when the server boots with an authorities engine
 * configured (AUTHORITIES_MODE) — a gated skill with no engine would trip the
 * boot-time fail-fast check, so it must NOT be part of the default app.
 */
@App({
  name: 'skills-e2e',
  tools: [GitHubGetPRTool, GitHubAddCommentTool, SlackNotifyTool, AdminActionTool],
  skills: [
    ReviewPRSkill,
    NotifyTeamSkill,
    HiddenSkill,
    DeploySkill,
    FullPRWorkflowSkill,
    McpOnlySkill,
    HttpOnlySkill,
    DocsSkill,
    AdminGatedSkill,
  ],
  plugins: [DevOpsPlugin],
})
export class SkillsE2EAuthoritiesApp {}
