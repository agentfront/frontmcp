import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { tenantId: z.string() };
const outputSchema = z.object({ tenantId: z.string(), ok: z.boolean() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * ABAC check bound to INPUT: `input.tenantId` must equal the caller's JWT
 * `claims.tenantId`. A classic IDOR-style vector — make sure a user from
 * tenant A cannot read tenant B just by passing B's id.
 */
@Tool({
  name: 'tenant-read',
  description: 'Read data for a tenant — caller must belong to the same tenant (ABAC).',
  inputSchema,
  outputSchema,
  authorities: 'matchTenant',
})
export default class TenantReadTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { tenantId: input.tenantId, ok: true };
  }
}
