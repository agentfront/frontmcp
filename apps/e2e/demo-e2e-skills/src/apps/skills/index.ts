import { App } from '@frontmcp/sdk';
import { GitHubGetPRTool } from './tools/github-get-pr.tool';
import { GitHubAddCommentTool } from './tools/github-add-comment.tool';
import { SlackNotifyTool } from './tools/slack-notify.tool';
import { AdminActionTool } from './tools/admin-action.tool';
import { DevOpsPlugin } from './plugins/devops-plugin';
import {
  ReviewPRSkill,
  NotifyTeamSkill,
  HiddenSkill,
  DeploySkill,
  FullPRWorkflowSkill,
  McpOnlySkill,
  HttpOnlySkill,
} from './skills';

@App({
  name: 'skills-e2e',
  tools: [GitHubGetPRTool, GitHubAddCommentTool, SlackNotifyTool, AdminActionTool],
  skills: [ReviewPRSkill, NotifyTeamSkill, HiddenSkill, DeploySkill, FullPRWorkflowSkill, McpOnlySkill, HttpOnlySkill],
  plugins: [DevOpsPlugin],
})
export class SkillsE2EApp {}
