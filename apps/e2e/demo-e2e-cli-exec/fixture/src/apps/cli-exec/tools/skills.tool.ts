import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'skills',
  description: 'A tool named skills that conflicts with the reserved command',
  inputSchema: {
    category: z.string().describe('Skill category to list'),
  },
})
export default class SkillsTool extends ToolContext {
  async execute(input: { category: string }) {
    return { skills: `Skills in: ${input.category}` };
  }
}
