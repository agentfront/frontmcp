// file: libs/plugins/src/codecall/tools/search.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { SearchToolInput, searchToolInputSchema, SearchToolOutput, searchToolOutputSchema } from './search.schema';

@Tool({
  name: 'codecall:search',
  description: 'Invoke a CodeCall tool by name with given input',
  inputSchema: searchToolInputSchema,
  outputSchema: searchToolOutputSchema,
})
export default class InvokeTool extends ToolContext {
  async execute(input: SearchToolInput): Promise<SearchToolOutput> {
    return {} as any;
  }
}
