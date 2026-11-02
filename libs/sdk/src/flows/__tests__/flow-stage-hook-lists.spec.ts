/**
 * A stage runs its will, did and finally hooks only when it has some, and reads each list when the stage starts, so
 * hooks a run adds (the tool class's own, joined at `createToolCallContext`) still run on stages that had none before.
 * In dev mode (or with DEBUG), the first run of a flow for a hook owner logs the order its hooks resolve to.
 */
import 'reflect-metadata';

import type { HookMetadata } from '../../common';
import type { DirectClient } from '../../direct/client.types';
import { connect } from '../../direct/connect';
import {
  App,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Tool,
  ToolContext,
  type FlowCtxOf,
  type LogRecord,
} from '../../index';
import { describeHookOrder, type StageEntry } from '../flow.stages';

const ToolHook = FlowHooksOf('tools:call-tool');

const trace: string[] = [];

@Plugin({ name: 'stage-trace' })
class StageTracePlugin {
  @ToolHook.Did('findTool')
  didFindTool() {
    trace.push('plugin did findTool');
  }

  @ToolHook.Around('validateInput')
  async aroundValidateInput(_ctx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<unknown>) {
    trace.push('plugin around validateInput: before');
    await next();
    trace.push('plugin around validateInput: after');
  }

  @ToolHook.Finally('validateInput')
  finallyValidateInput() {
    trace.push('plugin finally validateInput');
  }
}

@Tool({ name: 'echo', inputSchema: {} })
class EchoTool extends ToolContext {
  async execute() {
    trace.push('execute');
    return { content: [{ type: 'text' as const, text: 'ok' }] };
  }

  @ToolHook.Will('checkToolCredentials')
  willCheckCredentials() {
    trace.push('tool will checkToolCredentials');
  }

  @ToolHook.Did('validateOutput')
  didValidateOutput() {
    trace.push('tool did validateOutput');
  }

  @ToolHook.Finally('validateOutput')
  finallyValidateOutput() {
    trace.push('tool finally validateOutput');
  }

  @ToolHook.Will('finalize')
  willFinalize() {
    trace.push('tool will finalize');
  }
}

@Tool({ name: 'plain', inputSchema: {} })
class PlainTool extends ToolContext {
  async execute() {
    return { content: [{ type: 'text' as const, text: 'ok' }] };
  }
}

@Tool({ name: 'guarded', inputSchema: {} })
class GuardedTool extends ToolContext {
  async execute() {
    return { content: [{ type: 'text' as const, text: 'ok' }] };
  }

  @ToolHook.Will('findTool')
  static refuseNobody() {
    trace.push('tool static will findTool');
  }
}

@App({ id: 'stages', name: 'Stages', tools: [EchoTool, PlainTool, GuardedTool], plugins: [StageTracePlugin] })
class StagesApp {}

describe('flow stage hook lists', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'stage-hooks', version: '1.0.0' },
      apps: [StagesApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    trace.length = 0;
  });

  it('runs registered and run-added hooks in stage order on every call', async () => {
    for (let i = 0; i < 2; i++) {
      trace.length = 0;
      await client.callTool('echo', {});
      expect(trace).toEqual([
        'plugin did findTool',
        'tool will checkToolCredentials',
        'plugin around validateInput: before',
        'plugin around validateInput: after',
        'plugin finally validateInput',
        'execute',
        'tool did validateOutput',
        'tool finally validateOutput',
        'tool will finalize',
      ]);
    }
  });
});

const logged: LogRecord[] = [];

@LogTransport({ name: 'HookOrderCapture', description: 'Keeps the log records for assertions' })
class HookOrderCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    logged.push(record);
  }
}

describe('the resolved hook order print', () => {
  const { NODE_ENV, DEBUG } = process.env;

  afterEach(() => {
    process.env['NODE_ENV'] = NODE_ENV;
    if (DEBUG === undefined) delete process.env['DEBUG'];
    else process.env['DEBUG'] = DEBUG;
  });

  async function hookOrderPrints(
    env: { NODE_ENV: string; DEBUG?: string },
    toolNames: string[] = ['echo', 'echo'],
  ): Promise<string[]> {
    process.env['NODE_ENV'] = env.NODE_ENV;
    if (env.DEBUG === undefined) delete process.env['DEBUG'];
    else process.env['DEBUG'] = env.DEBUG;
    logged.length = 0;
    const devClient = await connect({
      info: { name: 'stage-hooks-order', version: '1.0.0' },
      apps: [StagesApp],
      logging: { level: LogLevel.Info, enableConsole: false, transports: [HookOrderCapture] },
    });
    try {
      for (const toolName of toolNames) await devClient.callTool(toolName, {}).catch(() => undefined);
    } finally {
      await devClient.close();
    }
    return logged.map((record) => record.message).filter((message) => message.startsWith('Hook order of'));
  }

  const HEADER_END = ', lowest priority first (an around hook wraps what its brackets hold):';

  it('logs the order of each hooked stage of a flow once, in dev mode, at info level', async () => {
    const prints = await hookOrderPrints({ NODE_ENV: 'development' });

    const callTool = prints.filter((message) => message.startsWith("Hook order of 'tools:call-tool'"));
    expect(callTool).toEqual([
      [
        `Hook order of 'tools:call-tool' for 'stages' and EchoTool${HEADER_END}`,
        '  findTool: stage CallToolFlow.findTool (0) → did StageTracePlugin.didFindTool (0)',
        '  checkToolCredentials: will EchoTool.willCheckCredentials (0) → stage CallToolFlow.checkToolCredentials (0)',
        '  validateInput: around StageTracePlugin.aroundValidateInput (0) [ stage CallToolFlow.validateInput (0) ] → finally StageTracePlugin.finallyValidateInput (0)',
        '  validateOutput: stage CallToolFlow.validateOutput (0) → did EchoTool.didValidateOutput (0) → finally EchoTool.finallyValidateOutput (0)',
        '  finalize: will EchoTool.willFinalize (0) → stage CallToolFlow.finalize (0)',
      ].join('\n'),
    ]);
    const records = logged.filter((record) => record.message === callTool[0]);
    expect(records.map((record) => record.level)).toEqual([LogLevel.Info]);
  });

  it('logs once more for another hook owner, and for each entry class with hooks of its own', async () => {
    const prints = await hookOrderPrints({ NODE_ENV: 'development' }, ['echo', 'plain', 'plain', 'guarded', 'missing']);

    const callTool = prints.filter((message) => message.startsWith("Hook order of 'tools:call-tool'"));
    expect(callTool.map((message) => message.split('\n')[0])).toEqual([
      `Hook order of 'tools:call-tool' for 'stages' and EchoTool${HEADER_END}`,
      `Hook order of 'tools:call-tool' for 'stages'${HEADER_END}`,
      `Hook order of 'tools:call-tool' for 'stages' and GuardedTool${HEADER_END}`,
      `Hook order of 'tools:call-tool'${HEADER_END}`,
    ]);
    expect(callTool[1].split('\n').slice(1)).toEqual([
      '  findTool: stage CallToolFlow.findTool (0) → did StageTracePlugin.didFindTool (0)',
      '  validateInput: around StageTracePlugin.aroundValidateInput (0) [ stage CallToolFlow.validateInput (0) ] → finally StageTracePlugin.finallyValidateInput (0)',
    ]);
    expect(callTool[2]).toContain(
      '  findTool: will GuardedTool.refuseNobody (0) → stage CallToolFlow.findTool (0) → did StageTracePlugin.didFindTool (0)',
    );
  });

  it('logs it with DEBUG set outside dev mode', async () => {
    const prints = await hookOrderPrints({ NODE_ENV: 'test', DEBUG: '1' });

    expect(prints.filter((message) => message.startsWith("Hook order of 'tools:call-tool'"))).toHaveLength(1);
  });

  it('logs nothing outside dev mode without DEBUG', async () => {
    await expect(hookOrderPrints({ NODE_ENV: 'test' })).resolves.toEqual([]);
  });
});

describe('describeHookOrder', () => {
  class WrapPlugin {}

  function step(hook: Partial<HookMetadata>): StageEntry<unknown> {
    const metadata: HookMetadata = {
      flow: 'tools:call-tool',
      stage: 'execute',
      type: 'stage',
      method: 'm',
      target: null,
    };
    return { hook: { ...metadata, ...hook }, _priority: hook.priority ?? 0, _order: 0, method: async () => undefined };
  }

  it('skips the stages no hook joined, and names a step without a target after the flow class', () => {
    const base = { execute: [step({ method: 'execute' })], validateInput: [step({ method: 'validateInput' })] };
    const resolved = {
      ...base,
      aroundExecute: [step({ type: 'around', method: 'wrap', target: WrapPlugin, priority: -1 })],
    };

    expect(describeHookOrder(['validateInput', 'execute'], base, resolved, 'MyFlow')).toEqual([
      '  execute: around WrapPlugin.wrap (-1) [ stage MyFlow.execute (0) ]',
    ]);
  });
});
