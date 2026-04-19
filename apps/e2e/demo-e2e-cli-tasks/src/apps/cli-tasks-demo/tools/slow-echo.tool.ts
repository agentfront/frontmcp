import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  message: z.string(),
  delayMs: z.number().int().min(0).max(10_000).default(200),
};

const outputSchema = z.object({
  message: z.string(),
  pid: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'slow-echo',
  description: 'Sleeps then echoes. Reports the PID that actually executed the tool.',
  inputSchema,
  outputSchema,
  execution: { taskSupport: 'optional' },
})
export default class SlowEchoTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    await new Promise((r) => setTimeout(r, input.delayMs));
    return { message: input.message, pid: process.pid };
  }
}
