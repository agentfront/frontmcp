import { Skill } from '@frontmcp/sdk';

/**
 * MCP-Only Skill - only visible via MCP tools (searchSkills/loadSkills)
 * Not visible via HTTP endpoints (/llm.txt, /skills)
 */
@Skill({
  name: 'mcp-only-workflow',
  description: 'A workflow that is only discoverable via MCP protocol',
  instructions: `
## MCP-Only Workflow

This skill is only accessible via MCP tools and should not appear in HTTP endpoint responses.

### Steps
1. Use github_get_pr to fetch PR details
2. Review the changes
3. Provide feedback
`,
  tools: [{ name: 'github_get_pr', purpose: 'Fetch PR details' }],
  tags: ['mcp', 'workflow'],
  visibility: 'mcp',
})
export class McpOnlySkill {}
