import { Tool, ToolContext } from '@frontmcp/sdk';
import { getRuntimeContext } from '@frontmcp/utils';

@Tool({
  name: 'get_deployment_mode',
  description: 'Returns only the deployment mode from runtime context',
  inputSchema: {},
})
export default class GetDeploymentModeTool extends ToolContext {
  async execute(_input: Record<string, never>) {
    const ctx = getRuntimeContext();
    return { deployment: ctx.deployment };
  }
}
