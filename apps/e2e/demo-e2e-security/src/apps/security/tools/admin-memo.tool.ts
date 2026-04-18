import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { subject: z.string() };
const outputSchema = z.object({ filed: z.boolean(), subject: z.string() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * Admin-only via RBAC profile. Non-admin callers get a synchronous
 * `AuthorityDeniedError` at the `checkEntryAuthorities` flow stage AND the
 * tool must not appear on their `tools/list`.
 */
@Tool({
  name: 'admin-memo',
  description: 'File an admin-only memo. Requires the `admin` authority profile.',
  inputSchema,
  outputSchema,
  authorities: 'admin',
})
export default class AdminMemoTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { filed: true, subject: input.subject };
  }
}
