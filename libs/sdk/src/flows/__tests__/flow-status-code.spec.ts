/**
 * `state.statusCode` holds the HTTP status of the response a flow settled on (#766). When a later
 * stage responds again without a status, an earlier response's status must not linger, or finalize
 * hooks record it for the final output.
 */
import 'reflect-metadata';

import { App, FlowHooksOf, Plugin, Tool, ToolContext } from '../../common';
import { FlowControl } from '../../common/interfaces/flow.interface';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');
const statusesSeenAtFinalize: unknown[] = [];

@Plugin({ name: 'status-probe' })
class StatusProbe {
  @ToolHook.Will('finalize')
  respondWithStatusFirst() {
    throw FlowControl.respond({ status: 401, content: [{ type: 'text', text: 'denied' }] });
  }

  @ToolHook.Did('finalize')
  record(flowCtx: { state: { statusCode?: unknown } }) {
    statusesSeenAtFinalize.push(flowCtx.state.statusCode);
  }
}

@Tool({ name: 'ok', inputSchema: {} })
class OkTool extends ToolContext {
  async execute() {
    return 'fine';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [OkTool], plugins: [StatusProbe] })
class DeskApp {}

describe('state.statusCode', () => {
  it('is cleared when a later response carries no status', async () => {
    const server = await FrontMcpInstance.createDirect({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp] });

    await server.callTool('ok', {});
    await server.dispose();

    expect(statusesSeenAtFinalize).toEqual([undefined]);
  });
});
