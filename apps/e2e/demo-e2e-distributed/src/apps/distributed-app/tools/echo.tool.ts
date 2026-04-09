import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'echo',
  description: 'Echoes the input back with node metadata',
  inputSchema: z.object({
    message: z.string(),
  }),
})
export class EchoTool extends ToolContext<typeof EchoTool> {
  async execute({ message }: { message: string }) {
    const machineId = process.env['MACHINE_ID'] ?? 'unknown';
    return this.text(`[${machineId}] ${message}`);
  }
}
