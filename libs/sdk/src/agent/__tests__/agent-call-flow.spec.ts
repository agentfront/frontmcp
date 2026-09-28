/**
 * Calling an agent (`invoke_<agent>`) runs the `agents:call-agent` flow.
 *
 * An agent is listed and called as its `invoke_<agent>` tool, whose `tools:call-tool` flow applies
 * everything the agent declares (authorities, rate limit, concurrency, timeout, plugin gates). The
 * tool then ran the agent directly, so the `agents:call-agent` flow never ran: the hooks documented
 * for agent invocation (`AgentCallHook`, and the agent class's own hooks on that flow) never fired.
 * The agent's context was also built without the request's context providers, so `this.context`
 * threw `RequestContextNotAvailableError` inside the agent's own `execute()`.
 */
import 'reflect-metadata';

import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { Agent, AgentCallHook, AgentContext, App, LogLevel, Plugin, type FlowCtxOf } from '../../index';

const runs: string[] = [];

/** An LLM that answers at once, without calling a tool. */
const answeringAdapter = {
  completion: async () => ({ content: 'done', finishReason: 'stop' as const }),
};

@Plugin({ name: 'agent-call-audit' })
class AgentCallAuditPlugin {
  @AgentCallHook.Will('execute')
  willExecute(ctx: FlowCtxOf<'agents:call-agent'>) {
    runs.push(`plugin:will-execute:${ctx.state.agent?.name}`);
  }

  @AgentCallHook.Did('execute')
  didExecute(ctx: FlowCtxOf<'agents:call-agent'>) {
    runs.push(`plugin:did-execute:${ctx.state.agent?.name}`);
  }
}

@Agent({ name: 'hooked_helper', inputSchema: {}, llm: { adapter: answeringAdapter } })
class HookedHelperAgent extends AgentContext {
  @AgentCallHook.Will('execute')
  beforeRun() {
    runs.push('class:will-execute');
  }
}

@Agent({ name: 'context_reader', inputSchema: {}, llm: { adapter: answeringAdapter } })
class ContextReaderAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    const context = this.context;
    runs.push('context_reader ran');
    return `requestId:${typeof context.requestId} scopeId:${typeof context.scopeId}`;
  }
}

@App({
  id: 'help',
  name: 'Help',
  agents: [HookedHelperAgent, ContextReaderAgent],
  plugins: [AgentCallAuditPlugin],
})
class HelpApp {}

function textOf(result: unknown): string {
  return JSON.stringify(result);
}

describe('invoke_<agent> runs the agents:call-agent flow', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'agent-call-flow', version: '1.0.0' },
      apps: [HelpApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
  });

  it('runs AgentCallHook hooks a plugin registers for agent invocation', async () => {
    const result = await server.callTool('invoke_hooked_helper', {});

    expect(textOf(result)).toContain('done');
    expect(runs).toContain('plugin:will-execute:hooked_helper');
    expect(runs).toContain('plugin:did-execute:hooked_helper');
  });

  it("runs the agent class's own hooks on the agents:call-agent flow", async () => {
    await server.callTool('invoke_hooked_helper', {});

    expect(runs).toContain('class:will-execute');
    expect(runs.indexOf('class:will-execute')).toBeLessThan(runs.indexOf('plugin:did-execute:hooked_helper'));
  });

  it("gives an agent's own execute() the request context", async () => {
    const result = await server.callTool('invoke_context_reader', {});

    expect(runs).toContain('context_reader ran');
    expect(textOf(result)).toContain('requestId:string scopeId:string');
  });
});

describe('the agents:call-agent flow under the invoke_<agent> tool', () => {
  it('counts a call once against the global rate limit', async () => {
    @Agent({ name: 'limited_helper', inputSchema: {}, llm: { adapter: answeringAdapter } })
    class LimitedHelperAgent extends AgentContext {}

    @App({ id: 'limited', name: 'Limited', agents: [LimitedHelperAgent] })
    class LimitedApp {}

    const limited = await FrontMcpInstance.createDirect({
      info: { name: 'agent-call-flow-limited', version: '1.0.0' },
      apps: [LimitedApp],
      logging: { level: LogLevel.Off },
      throttle: { enabled: true, global: { maxRequests: 2, windowMs: 60_000 } },
    });
    try {
      const outcomes: string[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const result = (await limited.callTool('invoke_limited_helper', {})) as { isError?: boolean };
          outcomes.push(result.isError ? 'error' : 'ok');
        } catch {
          outcomes.push('refused');
        }
      }

      expect(outcomes.slice(0, 2)).toEqual(['ok', 'ok']);
      expect(outcomes[2]).not.toBe('ok');
    } finally {
      await limited.dispose();
    }
  });
});
