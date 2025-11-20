import { Tool, ToolContext } from '@frontmcp/sdk';
import z from 'zod';

@Tool({
  name: 'create-expense',
  description: 'Create an expense',
  inputSchema: {
    id: z.string().min(1).describe("The expense's id"),
  },
  outputSchema: {
    ok: z.string(),
  },
  cache: {
    ttl: 1000,
    slideWindow: true,
  },
  authorization: {
    requiredRoles: ['Admin'],
  },
})
export default class CreateExpenseTool extends ToolContext {
  async execute(input: { id: string }) {
    return {
      ok: 'OK',
    };
  }
}
