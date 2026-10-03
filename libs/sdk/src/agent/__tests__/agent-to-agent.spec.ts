/**
 * One agent reaching another: nested agents, swarm visibility, `invokeAgent()` and `swarm.maxCallDepth` (#678).
 *
 * All of these were accepted and ignored: `@Agent({ agents: [...] })` created the nested agents in the
 * agent's private scope but never gave them to its model, `swarm.canSeeOtherAgents` gave the model no
 * other agent, `this.invokeAgent()` always threw `Agent method "invokeAgent" is not available`, and
 * nothing limited how deep agents calling each other could go.
 *
 * A nested agent is called through its `invoke_<agent>` tool's flow in its parent's scope, so the
 * `rateLimit`, `concurrency` and plugin gates it declares apply there, whatever the parent's
 * `execution.useToolFlow` says.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/protocol';

import {
  Agent,
  AgentContext,
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
  type AgentPrompt,
  type AgentToolDefinition,
  type FlowCtxOf,
} from '../../common';
import { type DirectCallOptions, type DirectMcpServer } from '../../direct/direct.types';
import { AgentCallDepthExceededError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

/** The tool names each scripted model was offered, per completion. */
const offered: Record<string, string[][]> = {};
const runs: string[] = [];

/**
 * An LLM that calls `toolName` with `args` once, then answers with what the tool returned. It
 * records the tools it is offered under `label`.
 */
function callingModel(label: string, toolName: string, args: Record<string, unknown> = {}) {
  return {
    completion: async (prompt: AgentPrompt, tools?: AgentToolDefinition[]) => {
      (offered[label] ??= []).push((tools ?? []).map((tool) => tool.name).sort());
      const last = prompt.messages[prompt.messages.length - 1];
      if (last?.role === 'tool') return { content: last.content, finishReason: 'stop' as const };
      return {
        content: null,
        finishReason: 'tool_calls' as const,
        toolCalls: [{ id: `${label}-call`, name: toolName, arguments: args }],
      };
    },
  };
}

/** An LLM that answers at once. */
const answering = { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) };

// ---------------------------------------------------------------- nested agents

@Agent({ name: 'tide_reader', inputSchema: { place: z.string() }, llm: { adapter: answering } })
class TideReaderAgent extends AgentContext {
  override async execute(input: { place: string }) {
    runs.push(`tide_reader:${input.place}`);
    return { tide: `high at ${input.place}` };
  }
}

/** Its model calls its nested agent `tide_reader`. */
@Agent({
  name: 'harbor_master',
  inputSchema: {},
  llm: { adapter: callingModel('harbor_master', 'invoke_tide_reader', { place: 'dock 4' }) },
  agents: [TideReaderAgent],
})
class HarborMasterAgent extends AgentContext {}

@Agent({ name: 'aide', inputSchema: { note: z.string() }, llm: { adapter: answering } })
class AideAgent extends AgentContext {
  override async execute(input: { note: string }) {
    runs.push(`aide:${input.note}`);
    return { aide: input.note.toUpperCase() };
  }
}

// ---------------------------------------------------------------- swarm

@Agent({ name: 'researcher', inputSchema: { topic: z.string() }, llm: { adapter: answering } })
class ResearcherAgent extends AgentContext {
  override async execute(input: { topic: string }) {
    runs.push(`researcher:${input.topic}`);
    return { findings: `notes on ${input.topic}` };
  }
}

@Agent({ name: 'writer', inputSchema: {}, llm: { adapter: answering } })
class WriterAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('writer');
    return { draft: 'text' };
  }
}

/** Visible to nobody. */
@Agent({ name: 'hidden_worker', inputSchema: {}, llm: { adapter: answering }, swarm: { isVisible: false } })
class HiddenWorkerAgent extends AgentContext {}

/** Sees `researcher` and `hidden_worker` (which hides itself), and its model calls `researcher`. */
@Agent({
  name: 'coordinator',
  inputSchema: {},
  llm: { adapter: callingModel('coordinator', 'invoke_researcher', { topic: 'reefs' }) },
  swarm: { canSeeOtherAgents: true, visibleAgents: ['researcher', 'hidden_worker'] },
})
class CoordinatorAgent extends AgentContext {}

/** Sees every visible agent of its scope. */
@Agent({
  name: 'open_coordinator',
  inputSchema: {},
  llm: { adapter: callingModel('open_coordinator', 'invoke_writer') },
  swarm: { canSeeOtherAgents: true },
})
class OpenCoordinatorAgent extends AgentContext {}

/** No `swarm`: sees no other agent, and its model's call to one fails. */
@Agent({
  name: 'loner',
  inputSchema: {},
  llm: { adapter: callingModel('loner', 'invoke_researcher', { topic: 'x' }) },
})
class LonerAgent extends AgentContext {}

// ---------------------------------------------------------------- invokeAgent

/** Calls `target` with `args` through `this.invokeAgent()`, and reports what happened. */
@Agent({
  name: 'delegator',
  inputSchema: { target: z.string(), args: z.unknown().optional() },
  llm: { adapter: answering },
  agents: [AideAgent],
  swarm: { canSeeOtherAgents: true, visibleAgents: ['researcher'] },
})
class DelegatorAgent extends AgentContext {
  override async execute(input: { target: string; args?: unknown }) {
    try {
      return { result: await this.invokeAgent(input.target, input.args) };
    } catch (error) {
      return { error: (error as Error).message, code: (error as { code?: string }).code };
    }
  }
}

// ---------------------------------------------------------------- maxCallDepth

const hops: string[] = [];

/** Calls `pong`, which calls it back, until the chain is refused. */
@Agent({
  name: 'ping',
  inputSchema: { n: z.number() },
  llm: { adapter: answering },
  swarm: { canSeeOtherAgents: true, visibleAgents: ['pong'], maxCallDepth: 2 },
})
class PingAgent extends AgentContext {
  override async execute(input: { n: number }) {
    hops.push(`ping:${input.n}`);
    try {
      return { next: await this.invokeAgent('pong', { n: input.n + 1 }) };
    } catch (error) {
      return { stopped: (error as Error).message };
    }
  }
}

@Agent({
  name: 'pong',
  inputSchema: { n: z.number() },
  llm: { adapter: answering },
  swarm: { canSeeOtherAgents: true, visibleAgents: ['ping'] },
})
class PongAgent extends AgentContext {
  override async execute(input: { n: number }) {
    hops.push(`pong:${input.n}`);
    return { next: await this.invokeAgent('ping', { n: input.n + 1 }) };
  }
}

/** Calls itself through its own `invoke_` tool: refused at the default depth (3). */
@Agent({ name: 'echo_chamber', inputSchema: { n: z.number() }, llm: { adapter: answering } })
class EchoChamberAgent extends AgentContext {
  override async execute(input: { n: number }) {
    hops.push(`echo_chamber:${input.n}`);
    const result = await this.callTool('invoke_echo_chamber', { n: input.n + 1 });
    return { depth: input.n, inner: result.structuredContent };
  }
}

@App({
  id: 'crew',
  name: 'Crew',
  agents: [
    HarborMasterAgent,
    ResearcherAgent,
    WriterAgent,
    HiddenWorkerAgent,
    CoordinatorAgent,
    OpenCoordinatorAgent,
    LonerAgent,
    DelegatorAgent,
    PingAgent,
    PongAgent,
    EchoChamberAgent,
  ],
})
class CrewApp {}

describe('one agent calling another', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'agent-to-agent', version: '1.0.0' },
      apps: [CrewApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
    hops.length = 0;
  });

  async function call(
    name: string,
    args: Record<string, unknown> = {},
    options?: DirectCallOptions,
  ): Promise<CallToolResult> {
    return server.callTool(name, args, options);
  }

  describe('nested agents (agents: [...])', () => {
    it("are offered to the agent's model as invoke_<agent> tools, and run when it calls them", async () => {
      const result = await call('invoke_harbor_master');

      expect(offered['harbor_master']?.[0]).toEqual(['invoke_tide_reader']);
      expect(runs).toEqual(['tide_reader:dock 4']);
      expect(JSON.stringify(result.structuredContent)).toContain('high at dock 4');
    });

    it('stay private to the agent: clients are not offered them', async () => {
      const { tools } = await server.listTools();
      const names = tools.map((tool) => tool.name);

      expect(names).toContain('invoke_harbor_master');
      expect(names).not.toContain('invoke_tide_reader');
      expect(names).not.toContain('invoke_aide');
    });
  });

  describe('swarm', () => {
    it('offers the model the agents it sees: visibleAgents, less those that hide themselves', async () => {
      const result = await call('invoke_coordinator');

      expect(offered['coordinator']?.[0]).toEqual(['invoke_researcher']);
      expect(runs).toEqual(['researcher:reefs']);
      expect(result.structuredContent).toEqual({ findings: 'notes on reefs' });
    });

    it('offers every visible agent but itself without visibleAgents', async () => {
      await call('invoke_open_coordinator');
      const names = offered['open_coordinator']?.[0] ?? [];

      expect(names).toEqual(expect.arrayContaining(['invoke_researcher', 'invoke_writer', 'invoke_coordinator']));
      expect(names).not.toContain('invoke_open_coordinator');
      expect(names).not.toContain('invoke_hidden_worker');
      // A nested agent belongs to its agent, not to the scope
      expect(names).not.toContain('invoke_tide_reader');
      expect(runs).toEqual(['writer']);
    });

    it('offers no other agent without canSeeOtherAgents, and refuses the call', async () => {
      const result = await call('invoke_loner');

      expect(offered['loner']?.[0]).toEqual([]);
      expect(runs).toEqual([]);
      expect(result.structuredContent).toEqual({
        error: 'Tool "invoke_researcher" not found in agent "loner". Available tools: []',
      });
    });
  });

  describe('this.invokeAgent()', () => {
    it('calls a nested agent and returns its output', async () => {
      const result = await call('invoke_delegator', { target: 'aide', args: { note: 'stow the lines' } });

      expect(result.structuredContent).toEqual({ result: { aide: 'STOW THE LINES' } });
      expect(runs).toEqual(['aide:stow the lines']);
    });

    it('calls an agent of its scope that it sees', async () => {
      const result = await call('invoke_delegator', { target: 'researcher', args: { topic: 'kelp' } });

      expect(result.structuredContent).toEqual({ result: { findings: 'notes on kelp' } });
    });

    it('refuses an agent it does not see', async () => {
      const result = await call('invoke_delegator', { target: 'writer', args: {} });

      expect(result.structuredContent).toEqual({
        error: 'Agent "delegator" does not have visibility to agent "writer"',
        code: 'AGENT_VISIBILITY_DENIED',
      });
      expect(runs).toEqual([]);
    });

    it('refuses an agent that does not exist', async () => {
      const result = await call('invoke_delegator', { target: 'nobody', args: {} });

      expect(result.structuredContent).toEqual({ error: 'Agent not found: nobody', code: 'AGENT_NOT_FOUND' });
    });

    it('refuses an input that is not an object of arguments', async () => {
      const result = await call('invoke_delegator', { target: 'aide', args: 'stow the lines' });

      expect(result.structuredContent).toEqual(
        expect.objectContaining({
          error: 'invokeAgent("aide"): the input must be an object of the agent\'s arguments',
        }),
      );
      expect(runs).toEqual([]);
    });

    it("reports the called agent's failure as the error its invoke_<agent> tool failed with", async () => {
      const result = await call('invoke_delegator', { target: 'aide', args: { note: 42 } });

      expect(result.structuredContent).toEqual({ error: 'Invalid tool input', code: 'INVALID_INPUT' });
      expect(runs).toEqual([]);
    });
  });

  describe('under a consent selection', () => {
    it('covers the nested agents the model calls, which the consent screen never offers', async () => {
      const result = await call('invoke_harbor_master', {}, consentTo('invoke_harbor_master'));

      expect(runs).toEqual(['tide_reader:dock 4']);
      expect(JSON.stringify(result.structuredContent)).toContain('high at dock 4');
    });

    it('covers a nested agent called with this.invokeAgent()', async () => {
      const result = await call(
        'invoke_delegator',
        { target: 'aide', args: { note: 'stow the lines' } },
        consentTo('invoke_delegator'),
      );

      expect(result.structuredContent).toEqual({ result: { aide: 'STOW THE LINES' } });
    });

    it('still applies to a swarm agent, which the consent screen offers', async () => {
      const refused = await call('invoke_coordinator', {}, consentTo('invoke_coordinator'));
      const allowed = await call('invoke_coordinator', {}, consentTo('invoke_coordinator', 'invoke_researcher'));

      expect(JSON.stringify(refused.structuredContent)).toContain('was not consented for this session');
      expect(allowed.structuredContent).toEqual({ findings: 'notes on reefs' });
      expect(runs).toEqual(['researcher:reefs']);
    });
  });

  describe('swarm.maxCallDepth', () => {
    it('refuses a call deeper than the smallest maxCallDepth of the agents running', async () => {
      const result = await call('invoke_ping', { n: 0 });

      // ping -> pong is call 1, pong -> ping is call 2, ping -> pong would be call 3 > 2
      expect(hops).toEqual(['ping:0', 'pong:1', 'ping:2']);
      expect(JSON.stringify(result.structuredContent)).toContain(
        `can't be called from \\"ping\\" -> \\"pong\\" -> \\"ping\\": that would be agent call 3, deeper than maxCallDepth 2`,
      );
    });

    it('stops an agent that calls itself at the default depth of 3', async () => {
      const outcome = call('invoke_echo_chamber', { n: 0 });

      await expect(outcome).rejects.toBeInstanceOf(AgentCallDepthExceededError);
      await expect(outcome).rejects.toThrow(
        'Agent "echo_chamber" can\'t be called from "echo_chamber" -> "echo_chamber" -> "echo_chamber" -> "echo_chamber": ' +
          'that would be agent call 4, deeper than maxCallDepth 3',
      );
      expect(hops).toEqual(['echo_chamber:0', 'echo_chamber:1', 'echo_chamber:2', 'echo_chamber:3']);
    });

    it('starts a new chain for every client call', async () => {
      await expect(call('invoke_echo_chamber', { n: 0 })).rejects.toThrow('maxCallDepth 3');
      hops.length = 0;
      await expect(call('invoke_echo_chamber', { n: 0 })).rejects.toThrow('maxCallDepth 3');

      expect(hops).toHaveLength(4);
    });
  });
});

// ---------------------------------------------------------------- the gates a nested agent declares

const ToolHook = FlowHooksOf('tools:call-tool');

/** The tools whose `tools:call-tool` flow `QuayAuditPlugin` hooked. */
const hooked: string[] = [];

/** Installed on an agent: records the tools whose `tools:call-tool` flow it hooks. */
@Plugin({ name: 'quay-audit' })
class QuayAuditPlugin {
  @ToolHook.Will('execute')
  audit(ctx: FlowCtxOf<'tools:call-tool'>) {
    hooked.push(ctx.state.tool?.name ?? '?');
  }
}

/** One call a minute: in its server, only nested agents declare a limit. */
@Agent({
  name: 'tally_clerk',
  inputSchema: {},
  llm: { adapter: answering },
  rateLimit: { maxRequests: 1, windowMs: 60_000 },
})
class TallyClerkAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('tally_clerk');
    return { tallied: true };
  }
}

@Agent({
  name: 'tally_master',
  inputSchema: {},
  llm: { adapter: callingModel('tally_master', 'invoke_tally_clerk') },
  agents: [TallyClerkAgent],
})
class TallyMasterAgent extends AgentContext {}

let releaseCrane: () => void = () => undefined;
const craneGate = new Promise<void>((resolve) => {
  releaseCrane = resolve;
});

/** One run at a time, no queue. */
@Agent({
  name: 'crane_operator',
  inputSchema: {},
  llm: { adapter: answering },
  concurrency: { maxConcurrent: 1, queueTimeoutMs: 0 },
})
class CraneOperatorAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('crane_operator');
    await craneGate;
    return { lifted: true };
  }
}

@Agent({
  name: 'crane_master',
  inputSchema: {},
  llm: { adapter: callingModel('crane_master', 'invoke_crane_operator') },
  agents: [CraneOperatorAgent],
})
class CraneMasterAgent extends AgentContext {}

/** One call a minute, nested in an agent that runs its own tools directly. */
@Agent({
  name: 'swift_clerk',
  inputSchema: {},
  llm: { adapter: answering },
  rateLimit: { maxRequests: 1, windowMs: 60_000 },
})
class SwiftClerkAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('swift_clerk');
    return { tallied: true };
  }
}

/** Runs its own tools directly (`useToolFlow: false`); its plugin hooks `tools:call-tool`. */
@Agent({
  name: 'swift_master',
  inputSchema: {},
  llm: { adapter: callingModel('swift_master', 'invoke_swift_clerk') },
  agents: [SwiftClerkAgent],
  plugins: [QuayAuditPlugin],
  execution: { useToolFlow: false },
})
class SwiftMasterAgent extends AgentContext {}

@App({ id: 'quay', name: 'Quay', agents: [TallyMasterAgent, CraneMasterAgent, SwiftMasterAgent] })
class QuayApp {}

@Tool({ name: 'hoist', inputSchema: {} })
class HoistTool extends ToolContext {
  async execute() {
    runs.push('hoist');
    return { hoisted: true };
  }
}

/** Its model calls its own tool `hoist`. */
@Agent({ name: 'rigger', inputSchema: {}, llm: { adapter: callingModel('rigger', 'hoist') }, tools: [HoistTool] })
class RiggerAgent extends AgentContext {}

/** Its model calls its nested agent `rigger`, whose model calls its own tool. */
@Agent({
  name: 'boatswain',
  inputSchema: {},
  llm: { adapter: callingModel('boatswain', 'invoke_rigger') },
  agents: [RiggerAgent],
})
class BoatswainAgent extends AgentContext {}

@Agent({ name: 'spotter', inputSchema: {}, llm: { adapter: answering } })
class SpotterAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('spotter');
    return { spotted: true };
  }
}

/** Sees its sibling `spotter` in the agent it is nested in, and its model calls it. */
@Agent({
  name: 'signaller',
  inputSchema: {},
  llm: { adapter: callingModel('signaller', 'invoke_spotter') },
  swarm: { canSeeOtherAgents: true, visibleAgents: ['spotter'] },
})
class SignallerAgent extends AgentContext {}

@Agent({
  name: 'mate',
  inputSchema: {},
  llm: { adapter: callingModel('mate', 'invoke_signaller') },
  agents: [SignallerAgent, SpotterAgent],
})
class MateAgent extends AgentContext {}

@App({ id: 'deck', name: 'Deck', agents: [BoatswainAgent, MateAgent] })
class DeckApp {}

describe('the gates a nested agent declares', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    // No `throttle`, and nothing but nested agents declares a limit
    server = await FrontMcpInstance.createDirect({
      info: { name: 'nested-agent-gates', version: '1.0.0' },
      apps: [QuayApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
    hooked.length = 0;
  });

  it("apply its rateLimit when its parent's model calls it", async () => {
    const first = await server.callTool('invoke_tally_master', {});
    const second = await server.callTool('invoke_tally_master', {});

    expect(first.structuredContent).toEqual({ tallied: true });
    expect(JSON.stringify(second.structuredContent)).toContain('Rate limit exceeded');
    expect(runs).toEqual(['tally_clerk']);
  });

  it("apply its concurrency when its parent's model calls it", async () => {
    const first = server.callTool('invoke_crane_master', {});
    await until(() => runs.length === 1);

    const second = server.callTool('invoke_crane_master', {});
    // Without the limit the second call starts the nested agent too, and waits on the same gate.
    const settled = await Promise.race([second, until(() => runs.length === 2).then(() => 'started' as const)]);
    releaseCrane();
    const [firstResult] = await Promise.all([first, second]);

    expect(settled === 'started' ? settled : JSON.stringify(settled.structuredContent)).toContain(
      'Concurrency limit reached for \\"invoke_crane_operator\\" (max: 1)',
    );
    expect(firstResult.structuredContent).toEqual({ lifted: true });
    expect(runs).toEqual(['crane_operator']);
  });

  it('run through its invoke_<agent> tool flow when the parent runs its own tools directly (useToolFlow: false)', async () => {
    const first = await server.callTool('invoke_swift_master', {});
    const second = await server.callTool('invoke_swift_master', {});

    expect(first.structuredContent).toEqual({ tallied: true });
    expect(JSON.stringify(second.structuredContent)).toContain('Rate limit exceeded');
    expect(runs).toEqual(['swift_clerk']);
    // The parent agent's plugin hooks the nested agent's tool flow
    expect(hooked).toEqual(['invoke_swift_clerk']);
  });
});

describe('calls an agent makes during its run', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'agent-global-slot', version: '1.0.0' },
      apps: [DeckApp],
      logging: { level: LogLevel.Off },
      throttle: { enabled: true, globalConcurrency: { maxConcurrent: 1, queueTimeoutMs: 0 } },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
  });

  it("run inside the global concurrency slot of the agent's call", async () => {
    const result = await server.callTool('invoke_boatswain', {});

    // boatswain holds the only global slot while its nested agent and that agent's tool run
    expect(result.structuredContent).toEqual({ hoisted: true });
    expect(runs).toEqual(['hoist']);
  });

  it('are covered by the consent given to the agent when they reach its nested agents and own tools', async () => {
    const result = await server.callTool('invoke_boatswain', {}, consentTo('invoke_boatswain'));

    expect(result.structuredContent).toEqual({ hoisted: true });
    expect(runs).toEqual(['hoist']);
  });

  it('are covered by the consent given to the agent when a nested agent calls a sibling it sees', async () => {
    const result = await server.callTool('invoke_mate', {}, consentTo('invoke_mate'));

    expect(result.structuredContent).toEqual({ spotted: true });
    expect(runs).toEqual(['spotter']);
  });
});

/** Call options for a caller whose token selected only `selectedTools` on the consent screen. */
function consentTo(...selectedTools: string[]): DirectCallOptions {
  return { authContext: { extra: { consent: { enabled: true, selectedTools } } } };
}

/** Resolves once `condition` holds, or after about a second; never rejects. */
async function until(condition: () => boolean): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10).unref());
  }
  return condition();
}
