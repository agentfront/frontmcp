import z from 'zod';
import {SessionRedisProvider} from '../provders';
import {Tool, ToolContext} from '@frontmcp/sdk';

const inputSchema = {
  id: z.string().describe('The expense id'),
  name: z.string().describe('The expense name'),
};
const outputSchema = {ok: z.string()};

type In = z.baseObjectInputType<typeof inputSchema> & { value?: string };
type Out = z.baseObjectOutputType<typeof outputSchema>;

@Tool({
  name: 'create-or-update-expense',
  description: 'Create or update an expense',
  inputSchema,
  outputSchema,
})
export default class CreateOrUpdateExpenseTool extends ToolContext<In, Out> {
  async execute(input: In): Promise<Out> {
    const red = this.get(SessionRedisProvider);
    await red.setValue('expense-id', input.id);


    return {
      ok: 'asdasdsd',
    };
  }
}
















