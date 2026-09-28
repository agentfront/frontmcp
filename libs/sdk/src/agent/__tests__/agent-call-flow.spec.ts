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

import { z } from '@frontmcp/lazy-zod';

import { completionEventsOf } from '../../channel/sources/completion-events';
import { type DirectMcpServer } from '../../direct/direct.types';
import { ElicitationFallbackRequired } from '../../errors/elicitation.error';
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

describe('the agents:call-agent flow keeps the tools/call request correlation', () => {
  // The JSON-RPC id routes an elicitation through the request's stream, and the progress token
  // tags progress notifications. Both belong to the tools/call request that invoked the agent.
  const seen: { relatedRequestId?: unknown; progressToken?: unknown } = {};

  @Agent({ name: 'correlated_helper', inputSchema: {}, llm: { adapter: answeringAdapter } })
  class CorrelatedHelperAgent extends AgentContext {
    override async execute(_input: Record<string, never>) {
      await this.tryGetContext()?.transport?.elicit('Continue?', { type: 'object', properties: {} });
      await this.progress(1, 2, 'half way');
      return 'correlated';
    }
  }

  @App({ id: 'correlated', name: 'Correlated', agents: [CorrelatedHelperAgent] })
  class CorrelatedApp {}

  it('routes elicitation with the tools/call request id and sends progress with its token', async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'agent-call-flow-correlation', version: '1.0.0' },
      apps: [CorrelatedApp],
      logging: { level: LogLevel.Off },
    });
    const [scope] = instance.getScopes() as unknown as Array<{
      runFlowForOutput: (name: string, input: unknown) => Promise<unknown>;
      notifications: { sendProgressNotification: (...args: unknown[]) => Promise<boolean> };
    }>;
    const sendProgress = jest
      .spyOn(scope.notifications, 'sendProgressNotification')
      .mockImplementation(async (_sessionId, token) => {
        seen.progressToken = token;
        return true;
      });
    const transport = {
      type: 'test',
      sendElicitRequest: jest.fn(async (relatedRequestId: unknown) => {
        seen.relatedRequestId = relatedRequestId;
        return { action: 'accept', content: {} };
      }),
    };

    const result = await scope.runFlowForOutput('tools:call-tool', {
      request: {
        method: 'tools/call',
        params: { name: 'invoke_correlated_helper', arguments: {}, _meta: { progressToken: 'progress-7' } },
      },
      ctx: { authInfo: { token: '', clientId: 'c', scopes: [], sessionId: 'session-1', transport }, requestId: 42 },
    });

    expect(JSON.stringify(result)).toContain('correlated');
    expect(seen.relatedRequestId).toBe(42);
    expect(seen.progressToken).toBe('progress-7');
    sendProgress.mockRestore();
  });
});

describe('agents:call-agent under the invoke tool: timeout and completion events', () => {
  const events: Array<{ agentName: string; status: string }> = [];

  @Agent({ name: 'slow_helper', inputSchema: {}, llm: { adapter: answeringAdapter }, execution: { timeout: 50 } })
  class SlowHelperAgent extends AgentContext {
    override async execute(_input: Record<string, never>) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return 'late';
    }
  }

  @Agent({
    name: 'bad_output',
    inputSchema: {},
    outputSchema: z.object({ count: z.number() }),
    llm: { adapter: answeringAdapter },
  })
  class BadOutputAgent extends AgentContext {
    override async execute(_input: Record<string, never>) {
      return 'not an object' as never;
    }
  }

  @Agent({ name: 'asks_first', inputSchema: {}, llm: { adapter: answeringAdapter } })
  class AsksFirstAgent extends AgentContext {
    override async execute(_input: Record<string, never>): Promise<string> {
      throw new ElicitationFallbackRequired(
        'elicit-1',
        'Continue?',
        { type: 'object' },
        'invoke_asks_first',
        {},
        60_000,
      );
    }
  }

  @App({ id: 'outcomes', name: 'Outcomes', agents: [SlowHelperAgent, BadOutputAgent, AsksFirstAgent] })
  class OutcomesApp {}

  let server: DirectMcpServer;
  let unsubscribe: () => void;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'agent-call-flow-outcomes', version: '1.0.0' },
      apps: [OutcomesApp],
      logging: { level: LogLevel.Off },
    });
    const scope = (server as unknown as { scope?: object }).scope;
    if (!scope) throw new Error('direct server exposes no scope');
    unsubscribe = completionEventsOf(scope).agents.subscribe((event) =>
      events.push({ agentName: event.agentName, status: event.status }),
    );
  });

  afterAll(async () => {
    unsubscribe?.();
    await server.dispose();
  });

  beforeEach(() => {
    events.length = 0;
  });

  it("enforces the agent's execution.timeout", async () => {
    let outcome: string;
    try {
      const result = (await server.callTool('invoke_slow_helper', {})) as { isError?: boolean };
      outcome = result.isError ? 'error' : JSON.stringify(result);
    } catch {
      outcome = 'refused';
    }

    expect(outcome).not.toContain('late');
  });

  it('publishes an error, not a success, when the output fails validation', async () => {
    await server.callTool('invoke_bad_output', {}).catch(() => undefined);

    expect(events).toEqual([{ agentName: 'bad_output', status: 'error' }]);
  });

  it('publishes nothing while the call waits for an elicitation', async () => {
    await server.callTool('invoke_asks_first', {}).catch(() => undefined);

    expect(events).toEqual([]);
  });
});
