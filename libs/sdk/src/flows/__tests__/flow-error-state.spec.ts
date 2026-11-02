/**
 * A flow that fails records why in `state.flowError` before its error and finalize stages run, so a
 * finalize hook can tell a failed call from a successful one (#766: the observability plugin's
 * finalize hook ended a failed tool's span as a success and left its execution span open). A failure
 * of the finalize stage itself, such as an output schema refusing the answer, is recorded too, for
 * the Finally hooks of that stage.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, FlowHooksOf, Plugin, Tool, ToolContext } from '../../common';
import { InvalidOutputError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');
const seen: unknown[] = [];
const seenFinally: unknown[] = [];

@Plugin({ name: 'flow-error-probe' })
class FlowErrorProbe {
  @ToolHook.Did('finalize')
  record(flowCtx: { state: { flowError?: unknown } }) {
    seen.push(flowCtx.state.flowError);
  }

  @ToolHook.Finally('finalize')
  recordAlways(flowCtx: { state: { flowError?: unknown } }) {
    seenFinally.push(flowCtx.state.flowError);
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

@Tool({ name: 'refused', inputSchema: {}, outputSchema: { total: z.number() } })
class RefusedTool extends ToolContext {
  async execute() {
    return { total: 'twelve' } as unknown as { total: number };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [CrashTool, OkTool, RefusedTool], plugins: [FlowErrorProbe] })
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

@Plugin({ name: 'unprintable-thrower' })
class UnprintableThrower {
  @ToolHook.Will('execute')
  throwUnprintable() {
    throw Object.create(null);
  }
}

@App({ id: 'unprintable', name: 'Unprintable', tools: [OkTool], plugins: [UnprintableThrower, FlowErrorProbe] })
class UnprintableApp {}

const probeSeen: boolean[] = [];

@Plugin({ name: 'state-probe' })
class StateProbe {
  @ToolHook.Finally('finalize', { priority: -1 })
  markThenThrow(flowCtx: { state: { set(key: never, value: never): unknown } }) {
    flowCtx.state.set('probe' as never, true as never);
    throw new Error('the probe store is down');
  }

  @ToolHook.Finally('finalize', { priority: 1 })
  lookForMark(flowCtx: { state: object }) {
    probeSeen.push('probe' in flowCtx.state);
  }
}

@App({ id: 'probed', name: 'Probed', tools: [OkTool], plugins: [StateProbe] })
class ProbedApp {}

@Plugin({ name: 'finalize-breaker' })
class FinalizeBreaker {
  @ToolHook.Will('finalize')
  breakFinalize() {
    throw new Error('finalize broke');
  }
}

@App({ id: 'broken', name: 'Broken', tools: [CrashTool], plugins: [FinalizeBreaker, FlowErrorProbe] })
class BrokenFinalizeApp {}

describe('state.flowError', () => {
  beforeEach(() => {
    seen.length = 0;
    seenFinally.length = 0;
  });

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
    const zeroServer = await FrontMcpInstance.createDirect({
      info: { name: 'zero', version: '1.0.0' },
      apps: [ZeroApp],
    });
    await zeroServer.callTool('ok', {}).catch(() => undefined);
    await zeroServer.dispose();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Error);
  });

  it('is an Error, and the Finally hooks still run, when a stage threw a value String() cannot convert', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'unprintable', version: '1.0.0' },
      apps: [UnprintableApp],
    });
    await server.callTool('ok', {}).catch(() => undefined);
    await server.dispose();

    expect(seenFinally).toHaveLength(1);
    expect(String(seenFinally[0])).toContain('[object Object]');
  });

  it('loses a key a Finally hook added before a throw the runner dropped', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'probed', version: '1.0.0' },
      apps: [ProbedApp],
    });
    await server.callTool('ok', {});
    await server.dispose();

    expect(probeSeen).toEqual([false]);
  });

  it("is the output schema's refusal of the answer for the Finally hooks of finalize, whose Did hooks skip it", async () => {
    const server = await FrontMcpInstance.createDirect({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp] });

    await server.callTool('refused', {}).catch(() => undefined);
    await server.dispose();

    expect(seen).toEqual([]);
    expect(seenFinally).toEqual([expect.any(InvalidOutputError)]);
  });

  it('keeps the first failure, the one the client gets, when the finalize stage fails after it', async () => {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'broken', version: '1.0.0' },
      apps: [BrokenFinalizeApp],
    });

    const failure = await server.callTool('crash', {}).catch((error: unknown) => error);
    await server.dispose();

    expect(String(failure)).toContain('tool crashed');
    expect(seenFinally).toHaveLength(1);
    expect(String(seenFinally[0])).toContain('tool crashed');
  });
});
