import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {};

const outputSchema = z.object({
  pong: z.literal(true),
  timestamp: z.string(),
  serverName: z.string(),
});

type PingInput = z.infer<z.ZodObject<typeof inputSchema>>;
type PingOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'ping',
  description: 'Returns pong with timestamp - useful for health checks',
  inputSchema,
  outputSchema,
})
export default class PingTool extends ToolContext {
  async execute(_input: PingInput): Promise<PingOutput> {
    return {
      pong: true,
      timestamp: new Date().toISOString(),
      serverName: 'local-test-mcp',
    };
  }
}
