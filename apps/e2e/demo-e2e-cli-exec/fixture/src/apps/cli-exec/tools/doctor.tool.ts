import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'doctor',
  description: 'A tool named doctor that conflicts with the reserved command',
  inputSchema: {
    text: z.string().describe('Text to diagnose'),
  },
})
export default class DoctorTool extends ToolContext {
  async execute(input: { text: string }) {
    return { diagnosis: `Diagnosed: ${input.text}` };
  }
}
