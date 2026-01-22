import { App, Skill, skill } from '@frontmcp/sdk';
import { GitHubGetPRTool } from './tools/github-get-pr.tool';
import { GitHubAddCommentTool } from './tools/github-add-comment.tool';
import { SlackNotifyTool } from './tools/slack-notify.tool';
import { AdminActionTool } from './tools/admin-action.tool';
import { DevOpsPlugin } from './plugins/devops-plugin';

/**
 * Review PR Skill - demonstrates skill with detailed tool references
 */
@Skill({
  name: 'review-pr',
  description: 'Review a GitHub pull request for code quality and issues',
  instructions: `
## PR Review Process

1. First, fetch the PR details using github_get_pr
2. Review each changed file for:
   - Code quality issues
   - Security vulnerabilities
   - Performance concerns
3. Add review comments using github_add_comment
4. Summarize findings

### Important Notes
- Focus on constructive feedback
- Check for test coverage
  `,
  tools: [
    { name: 'github_get_pr', purpose: 'Fetch PR details and changed files', required: true },
    { name: 'github_add_comment', purpose: 'Add review comments' },
  ],
  tags: ['github', 'code-review'],
  parameters: [
    { name: 'pr_url', description: 'URL of the pull request to review', required: true, type: 'string' },
    { name: 'focus_areas', description: 'Specific areas to focus on', type: 'array' },
  ],
})
class ReviewPRSkill {}

/**
 * Notify Team Skill - demonstrates skill with simple tool references
 */
const NotifyTeamSkill = skill({
  name: 'notify-team',
  description: 'Notify team members via Slack about important updates',
  instructions: `
## Team Notification Process

1. Compose a clear, concise message
2. Use slack_notify to send the message to the appropriate channel
3. Confirm delivery

### Best Practices
- Keep messages actionable
- Include relevant links
- Tag appropriate team members
  `,
  tools: ['slack_notify'],
  tags: ['communication', 'slack'],
});

/**
 * Hidden Internal Skill - for testing hideFromDiscovery
 */
@Skill({
  name: 'hidden-internal',
  description: 'Internal skill for system operations',
  instructions: 'This skill is for internal use only and should not appear in search results.',
  hideFromDiscovery: true,
})
class HiddenSkill {}

/**
 * Deploy Skill - demonstrates skill with mixed tool availability
 */
@Skill({
  name: 'deploy-app',
  description: 'Deploy application to production environment',
  instructions: `
## Deployment Process

1. Run pre-deployment checks
2. Build the application using docker_build
3. Push to registry using docker_push
4. Deploy to Kubernetes using k8s_apply
5. Notify team of completion

### Safety Checks
- Verify all tests pass
- Check for security vulnerabilities
- Confirm rollback strategy
  `,
  tools: [
    { name: 'docker_build', purpose: 'Build Docker image', required: true },
    { name: 'docker_push', purpose: 'Push image to registry', required: true },
    { name: 'k8s_apply', purpose: 'Apply Kubernetes manifests', required: true },
    { name: 'slack_notify', purpose: 'Notify team of deployment status' },
  ],
  tags: ['deployment', 'devops', 'kubernetes'],
  priority: 10, // Higher priority for deployment workflows
})
class DeploySkill {}

/**
 * Multi-Tool Workflow Skill - tests union of allowed tools
 */
@Skill({
  name: 'full-pr-workflow',
  description: 'Complete PR review and notification workflow',
  instructions: `
## Full PR Workflow

1. Fetch PR using github_get_pr
2. Review and add comments using github_add_comment
3. Notify team via slack_notify

This workflow combines review and notification.
  `,
  tools: [
    { name: 'github_get_pr', purpose: 'Fetch PR details', required: true },
    { name: 'github_add_comment', purpose: 'Add review comments' },
    { name: 'slack_notify', purpose: 'Notify team' },
  ],
  tags: ['github', 'slack', 'workflow'],
})
class FullPRWorkflowSkill {}

@App({
  name: 'skills-e2e',
  tools: [GitHubGetPRTool, GitHubAddCommentTool, SlackNotifyTool, AdminActionTool],
  skills: [ReviewPRSkill, NotifyTeamSkill, HiddenSkill, DeploySkill, FullPRWorkflowSkill],
  plugins: [DevOpsPlugin],
})
export class SkillsE2EApp {}
