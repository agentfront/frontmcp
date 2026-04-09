import { Tool, ToolContext } from '@frontmcp/sdk';
import { getMachineId } from '@frontmcp/utils';

@Tool({
  name: 'node-info',
  description: 'Returns information about the current node',
})
export class NodeInfoTool extends ToolContext<typeof NodeInfoTool> {
  async execute() {
    const machineId = getMachineId();
    const pid = process.pid;
    const port = process.env['PORT'] ?? 'unknown';

    return this.text(
      JSON.stringify({
        machineId,
        pid,
        port,
        deployment: process.env['FRONTMCP_DEPLOYMENT_MODE'] ?? 'standalone',
      }),
    );
  }
}
