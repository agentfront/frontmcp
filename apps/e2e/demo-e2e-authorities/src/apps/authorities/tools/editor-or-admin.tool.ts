import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { content: z.string().default('draft') };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'editor-or-admin',
  description: 'A tool accessible to editors OR admins (anyOf combinator)',
  inputSchema,
  authorities: {
    anyOf: [
      { roles: { any: ['admin'] } },
      { permissions: { any: ['content:write', 'content:publish'] } },
    ],
  },
})
export default class EditorOrAdminTool extends ToolContext<typeof inputSchema> {
  async execute(input: Input) {
    return { published: input.content };
  }
}
