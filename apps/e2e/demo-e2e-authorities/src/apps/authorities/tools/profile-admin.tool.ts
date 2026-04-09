import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { query: z.string().default('status') };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'profile-admin',
  description: 'A tool using the "admin" profile shorthand',
  inputSchema,
  authorities: 'admin',
})
export default class ProfileAdminTool extends ToolContext {
  async execute(input: Input) {
    return { admin: true, query: input.query };
  }
}
