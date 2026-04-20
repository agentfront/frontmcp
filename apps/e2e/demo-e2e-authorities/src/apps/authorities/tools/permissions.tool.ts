import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { resource: z.string().default('users') };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'permissions-required',
  description: 'A tool requiring specific permissions (RBAC permissions.all)',
  inputSchema,
  authorities: {
    permissions: { all: ['users:read', 'users:write'] },
  },
})
export default class PermissionsTool extends ToolContext {
  async execute(input: Input) {
    return { access: 'granted', resource: input.resource };
  }
}
