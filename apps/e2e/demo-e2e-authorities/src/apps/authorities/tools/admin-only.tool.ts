import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { action: z.string().default('admin-action') };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'admin-only',
  description: 'A tool restricted to admin role (RBAC roles.any)',
  inputSchema,
  authorities: {
    roles: { any: ['admin', 'superadmin'] },
  },
})
export default class AdminOnlyTool extends ToolContext<typeof inputSchema> {
  async execute(input: Input) {
    return { result: `admin action: ${input.action}` };
  }
}
