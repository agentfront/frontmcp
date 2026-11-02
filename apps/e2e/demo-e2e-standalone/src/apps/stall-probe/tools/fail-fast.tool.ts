import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'fail-fast',
  description: 'Throws as soon as it runs',
  inputSchema: {},
})
export default class FailFastTool extends ToolContext {
  async execute(): Promise<string> {
    throw new Error('fail-fast always fails');
  }
}
