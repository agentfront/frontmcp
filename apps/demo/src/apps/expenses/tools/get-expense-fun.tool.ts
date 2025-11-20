import z from 'zod';
import {tool} from '@frontmcp/sdk';
import {ExpenseConfigProvider} from "../providers";


export default tool({
  name: 'get-expense-fun',
  description: 'Get an expense',
  inputSchema: {
    id: z.string().describe('The expense id'),
    name: z.string().describe('The expense name'),
  },
  outputSchema: {
    ok: z.string()
  },
})((input, ctx) => {

  const configProvider = ctx.get(ExpenseConfigProvider)
  return {
    ok: 'asdasdsd: ' + configProvider.get('redis').host,
  };
});
















