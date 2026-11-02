import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'probe-request',
  description: 'Answers ok; the request-probe plugin reports what its hook read about the call in the result _meta',
  inputSchema: {},
})
export default class ProbeRequestTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}
