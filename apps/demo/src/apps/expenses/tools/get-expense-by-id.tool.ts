import z from 'zod';
import {SessionRedisProvider} from '../provders';
import {Tool, ToolContext} from '@frontmcp/sdk';


@Tool({
  name: 'create-or-update-expense',
  description: 'Create or update an expense',
  inputSchema: {
    id: z.string().describe('The expense id'),
    name: z.string().describe('The expense name'),
  },
  outputSchema: {
    ok: z.string()
  },
})
export default class CreateOrUpdateExpenseTool extends ToolContext {
  async execute(input: { id: string, name: string }) {
    const red = this.get(SessionRedisProvider);
    await red.setValue('expense-id', input.id);

    return {
      ok: 'asdasdsd',
    };
  }
}
















