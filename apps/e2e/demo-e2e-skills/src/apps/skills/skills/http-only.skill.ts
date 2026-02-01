import { Skill } from '@frontmcp/sdk';

/**
 * HTTP-Only Skill - only visible via HTTP endpoints (/llm.txt, /skills)
 * Not visible via MCP tools (searchSkills/loadSkills)
 */
@Skill({
  name: 'http-only-workflow',
  description: 'A workflow that is only discoverable via HTTP endpoints',
  instructions: `
## HTTP-Only Workflow

This skill is only accessible via HTTP endpoints and should not appear in MCP search results.

### Steps
1. Fetch the resource via HTTP
2. Process the data
3. Return the result
`,
  tags: ['http', 'api', 'workflow'],
  visibility: 'http',
  parameters: [{ name: 'endpoint', description: 'The HTTP endpoint to call', required: true, type: 'string' }],
})
export class HttpOnlySkill {}
