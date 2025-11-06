import {FlowHooksOf, StageHookOf, Tool, ToolContext} from '@frontmcp/sdk';
import {} from '@frontmcp/core';
import z from 'zod';

const {Will} = FlowHooksOf('tools:call-tool')

@Tool({
  name: 'create-expense',
  description: 'Create an expense',
  inputSchema: {
    id: z.string().describe('The expense\'s id'),
  },
  outputSchema: {
    ok: z.string(),
  },
  cache: {
    ttl: 1000,
    slideWindow: true,
  },
  authorization: {
    requiredRoles: ['Admin']
  }
})
export default class CreateExpenseTool extends ToolContext {
  async execute(input: { id: string }) {
    return {
      ok: 'asdasdsd',
    };
  }


  @Will('acquireQuota')
  async willAcquireQuota() {
    console.log("asdsadsad")
  }

}
