import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { query: z.string().default('status') };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'profile-admin',
  description: 'A tool using the "admin" profile shorthand',
  inputSchema,
  authorities: 'admin',
})
export default class ProfileAdminTool extends ToolContext<typeof inputSchema> {
  async execute(input: Input) {
    return { admin: true, query: input.query };
  }
}
