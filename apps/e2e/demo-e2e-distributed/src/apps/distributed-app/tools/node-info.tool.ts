import { Tool, ToolContext } from '@frontmcp/sdk';
import { getMachineId } from '@frontmcp/utils';

const inputSchema = {};

@Tool({
  name: 'node-info',
  description: 'Returns information about the current node',
  inputSchema,
})
export default class NodeInfoTool extends ToolContext<typeof inputSchema> {
  async execute() {
    const machineId = getMachineId();
    const pid = process.pid;
    const port = process.env['PORT'] ?? 'unknown';

    return {
      machineId,
      pid,
      port,
      deployment: process.env['FRONTMCP_DEPLOYMENT_MODE'] ?? 'standalone',
    };
  }
}
