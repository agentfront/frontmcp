import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {};

const outputSchema = z.object({
  server: z.string(),
  apps: z.array(z.string()),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'server-info',
  description: 'Describe the server and the apps it composes',
  inputSchema,
  outputSchema,
})
export default class ServerInfoTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    return { server: 'Demo E2E MultiApp', apps: ['notes', 'tasks', 'calendar'] };
  }
}
