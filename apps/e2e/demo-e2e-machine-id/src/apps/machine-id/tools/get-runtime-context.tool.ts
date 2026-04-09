import { Tool, ToolContext } from '@frontmcp/sdk';
import { getRuntimeContext } from '@frontmcp/utils';

@Tool({
  name: 'get_runtime_context',
  description: 'Returns the full runtime context (platform, runtime, deployment, env)',
  inputSchema: {},
})
export default class GetRuntimeContextTool extends ToolContext {
  async execute() {
    return getRuntimeContext();
  }
}
