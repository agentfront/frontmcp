import { Skill } from '@frontmcp/sdk';

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
export class ReviewPRSkill {}
