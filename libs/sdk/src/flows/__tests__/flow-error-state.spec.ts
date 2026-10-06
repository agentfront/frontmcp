/**
 * A flow that fails records why in `state.flowError` before its error and finalize stages run, so a
 * finalize hook can tell a failed call from a successful one (#766: the observability plugin's
 * finalize hook ended a failed tool's span as a success and left its execution span open).
 */
import 'reflect-metadata';

import { App, FlowHooksOf, Plugin, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');
const seen: unknown[] = [];

@Plugin({ name: 'flow-error-probe' })
class FlowErrorProbe {
  @ToolHook.Did('finalize')
  record(flowCtx: { state: { flowError?: unknown } }) {
    seen.push(flowCtx.state.flowError);
  }
}

@Tool({ name: 'crash', inputSchema: {} })
class CrashTool extends ToolContext {
  async execute(): Promise<string> {
    throw new Error('tool crashed');
  }
}

@Tool({ name: 'ok', inputSchema: {} })
class OkTool extends ToolContext {
  async execute() {
    return 'fine';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [CrashTool, OkTool], plugins: [FlowErrorProbe] })
class DeskApp {}

@Plugin({ name: 'zero-thrower' })
class ZeroThrower {
  @ToolHook.Will('execute')
  throwZero() {
    throw 0;
  }
}

@App({ id: 'zero', name: 'Zero', tools: [OkTool], plugins: [ZeroThrower, FlowErrorProbe] })
class ZeroApp {}

describe('state.flowError', () => {
  it('is the error a failed call threw, and unset for a successful one', async () => {
    const server = await FrontMcpInstance.createDirect({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp] });

    await server.callTool('crash', {}).catch(() => undefined);
    await server.callTool('ok', {});
    await server.dispose();

    expect(seen).toHaveLength(2);
    expect(String(seen[0])).toContain('tool crashed');
    expect(seen[1]).toBeUndefined();
  });

  it('is an Error even when a stage threw a falsy value', async () => {
    seen.length = 0;
    const zeroServer = await FrontMcpInstance.createDirect({
      info: { name: 'zero', version: '1.0.0' },
      apps: [ZeroApp],
    });
    await zeroServer.callTool('ok', {}).catch(() => undefined);
    await zeroServer.dispose();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Error);
  });
});
