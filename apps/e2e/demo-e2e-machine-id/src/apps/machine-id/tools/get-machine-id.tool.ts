import { Tool, ToolContext } from '@frontmcp/sdk';
import { getMachineId } from '@frontmcp/utils';

@Tool({
  name: 'get_machine_id',
  description: 'Returns the current machine ID',
  inputSchema: {},
})
export default class GetMachineIdTool extends ToolContext {
  async execute() {
    return { machineId: getMachineId() };
  }
}
