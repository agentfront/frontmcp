/**
 * Plugins installed on an `@Agent` gate the agent's own tools.
 *
 * An agent's tools run through its private scope's `tools:call-tool` flow, whose hooks come only
 * from the plugins installed on the agent. Those hooks are owned by the agent (owner kind
 * `agent`), and the hook registry accepted only `scope`, `plugin` and `app` owners when it picked
 * the hooks for an entry, so every call of an agent's tool failed with
 * `UnsupportedHookOwnerKindError` instead of running the plugin's hooks.
 */
import 'reflect-metadata';

import {
  Agent,
  AgentContext,
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
  type FlowCtxOf,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');

const runs: string[] = [];

@Plugin({ name: 'agent-audit' })
class AuditPlugin {
  @ToolHook.Will('execute')
  audit(ctx: FlowCtxOf<'tools:call-tool'>) {
    runs.push(`audit:${ctx.state.tool?.name}`);
  }
}

@Plugin({ name: 'agent-gate' })
class RefuseEverythingPlugin {
  @ToolHook.Will('execute')
  refuse(ctx: FlowCtxOf<'tools:call-tool'>) {
    runs.push(`gate:${ctx.state.tool?.name}`);
    throw new Error(`gate refused ${ctx.state.tool?.name}`);
  }
}

@Tool({ name: 'lookup_order', inputSchema: {} })
class LookupOrderTool extends ToolContext {
  async execute() {
    runs.push('lookup_order ran');
    return { order: 'o-1' };
  }
}

/** An LLM that calls `lookup_order` once, then answers with what the tool returned. */
const triageAdapter = {
  completion: async (prompt: { messages: Array<{ role: string; content: string | null }> }) => {
    const last = prompt.messages[prompt.messages.length - 1];
    if (last?.role === 'tool') return { content: last.content, finishReason: 'stop' as const };
    return {
      content: null,
      finishReason: 'tool_calls' as const,
      toolCalls: [{ id: 'call-1', name: 'lookup_order', arguments: {} }],
    };
  },
};

@Agent({
  name: 'audited_triage',
  inputSchema: {},
  llm: { adapter: triageAdapter },
  tools: [LookupOrderTool],
  plugins: [AuditPlugin],
})
class AuditedTriageAgent extends AgentContext {}

@Agent({
  name: 'gated_triage',
  inputSchema: {},
  llm: { adapter: triageAdapter },
  tools: [LookupOrderTool],
  plugins: [RefuseEverythingPlugin],
})
class GatedTriageAgent extends AgentContext {}

@Tool({ name: 'desk_status', inputSchema: {} })
class DeskStatusTool extends ToolContext {
  async execute() {
    runs.push('desk_status ran');
    return { open: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [DeskStatusTool], agents: [AuditedTriageAgent, GatedTriageAgent] })
class DeskApp {}

describe('plugins installed on an @Agent', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'agent-plugin-hooks', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
  });

  it("run their hooks for the agent's tools, which still run", async () => {
    const result = await server.callTool('invoke_audited_triage', {});

    expect(runs).toEqual(['audit:lookup_order', 'lookup_order ran']);
    expect(JSON.stringify(result)).toContain('o-1');
  });

  it("can refuse the agent's tools", async () => {
    const result = await server.callTool('invoke_gated_triage', {});

    expect(runs).toEqual(['gate:lookup_order']);
    expect(JSON.stringify(result)).toContain('gate refused lookup_order');
  });

  it("do not run for the tools of the agent's app", async () => {
    await server.callTool('desk_status', {});

    expect(runs).toEqual(['desk_status ran']);
  });
});
