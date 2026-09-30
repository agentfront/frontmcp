import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  sub: z.string().nullable(),
  scopes: z.array(z.string()),
});

@Tool({
  name: 'whoami',
  description: 'Returns the subject and scopes the tool sees on this.auth',
  inputSchema: {},
  outputSchema,
})
export default class WhoAmITool extends ToolContext {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return {
      sub: this.auth.user?.sub ?? null,
      scopes: [...this.auth.scopes],
    };
  }
}
