/**
 * A stage runs its will and did hooks only when it has some, and reads each list when the stage starts, so hooks a
 * run adds (the tool class's own, joined at `createToolCallContext`) still run on stages that had none before.
 */
import 'reflect-metadata';

import type { DirectClient } from '../../direct/client.types';
import { connect } from '../../direct/connect';
import { App, FlowHooksOf, LogLevel, Plugin, Tool, ToolContext, type FlowCtxOf } from '../../index';

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

  @ToolHook.Will('finalize')
  willFinalize() {
    trace.push('tool will finalize');
  }
}

@App({ id: 'stages', name: 'Stages', tools: [EchoTool], plugins: [StageTracePlugin] })
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
        'execute',
        'tool did validateOutput',
        'tool will finalize',
      ]);
    }
  });
});
