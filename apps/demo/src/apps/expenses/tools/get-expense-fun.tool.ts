import z from 'zod';
import {SessionRedisProvider} from '../provders';
import {tool} from '@frontmcp/sdk';


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
})((input, sessionProvider: SessionRedisProvider) => {
  console.log('getExpenseFun', input, sessionProvider);
  return {
    ok: 'asdasdsd',
  };
});
















