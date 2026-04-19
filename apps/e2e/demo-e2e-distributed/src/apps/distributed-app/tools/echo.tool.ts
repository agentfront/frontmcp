import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  message: z.string(),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'echo',
  description: 'Echoes the input back with node metadata',
  inputSchema,
})
export default class EchoTool extends ToolContext {
  async execute({ message }: Input) {
    const machineId = process.env['MACHINE_ID'] ?? 'unknown';
    return { echo: `[${machineId}] ${message}` };
  }
}
