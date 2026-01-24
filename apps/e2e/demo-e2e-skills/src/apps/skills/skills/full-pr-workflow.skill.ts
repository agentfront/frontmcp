import { Skill } from '@frontmcp/sdk';

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
export class FullPRWorkflowSkill {}
