import { Skill } from '@frontmcp/sdk';

/**
 * Admin-Gated Skill — demonstrates `@Skill({ authorities })` enforcement.
 *
 * When the server is started with an authorities engine configured (see
 * `main.ts` AUTHORITIES_MODE), this skill is:
 *   - hidden from discovery (skill://index.json, skills/search, /skills) for
 *     callers without the `admin` role, and
 *   - denied on direct load/read (skills/load, skill://admin-gated/SKILL.md)
 *     with AuthorityDeniedError (MCP code -32003).
 *
 * Callers carrying the `admin` role see and load it normally.
 */
@Skill({
  name: 'admin-gated',
  description: 'A restricted workflow only admins may discover and load',
  instructions: `
## Admin-Only Workflow

This skill is restricted to administrators.

### Steps
1. Use admin_action to perform the privileged operation
2. Confirm the result
`,
  tools: [{ name: 'admin_action', purpose: 'Perform the privileged operation' }],
  tags: ['admin', 'restricted'],
  authorities: { roles: { any: ['admin'] } },
})
export class AdminGatedSkill {}
