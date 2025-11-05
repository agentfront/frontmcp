import {Tool, ToolContext} from '@frontmcp/sdk';
import z from 'zod';


const inputSchema = {
  id: z.string().describe('The expense\'s id'),
};
const outputSchema = {
  ok: z.string(),
};

type In = z.baseObjectInputType<typeof inputSchema> & { value?: string };
type Out = z.baseObjectOutputType<typeof outputSchema>;

@Tool({
  name: 'create-expense',
  description: 'Create an expense',
  inputSchema,
  outputSchema,
  cache: {
    ttl: 1000,
    slideWindow: true,
  },
})
export default class CreateExpenseTool extends ToolContext<In, Out> {

  async execute(input: In): Promise<Out> {
    return {
      ok: 'secrwdmqwkldmqwlkdet',
    };
  }

}
