// file: libs/plugins/src/codecall/tools/invoke.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { InvokeToolInput, invokeToolInputSchema, InvokeToolOutput, invokeToolOutputSchema } from './invoke.schema';

@Tool({
  name: 'codecall:invoke',
  description: 'Invoke a CodeCall tool by name with given input',
  inputSchema: invokeToolInputSchema,
  outputSchema: invokeToolOutputSchema,
})
export default class InvokeTool extends ToolContext {
  async execute(input: InvokeToolInput): Promise<InvokeToolOutput> {
    return {} as any;
  }
}
