import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  Agent,
  AgentContext,
  App,
  frontMcpAgentMetadataSchema,
  FrontMcpAgentTokens,
  Tool,
  ToolContext,
} from '../../common';
import { type Scope } from '../../scope/scope.instance';
import { AGENT_ONLY_METADATA_KEYS } from '../agent.instance';
import { extractAgentClassMetadata } from '../agent.utils';

/**
 * An `@Agent` is listed and called through its `invoke_<agent>` tool, so every gate the agent
 * declares must reach that tool: `tools/list` and `tools/call` only look at the tool's metadata.
 * The agent must be refused exactly like a tool that declares the same gate.
 */

const llmAdapter = {
  completion: jest.fn().mockResolvedValue({ content: 'done', finishReason: 'stop' }),
};

const runs: string[] = [];

/** Runs only on an edge runtime; the specs run on Node. */
@Agent({
  name: 'edge_only',
  description: 'Only available on the edge',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  availableWhen: { runtime: ['edge'] },
})
class EdgeOnlyAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('edge_only');
    return { ran: true };
  }
}

@Tool({ name: 'edge_tool', inputSchema: {}, availableWhen: { runtime: ['edge'] } })
class EdgeTool extends ToolContext {
  async execute() {
    runs.push('edge_tool');
    return { ran: true };
  }
}

@Agent({
  name: 'everywhere',
  description: 'Available everywhere',
  inputSchema: {},
  llm: { adapter: llmAdapter },
})
class EverywhereAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('everywhere');
    return { ran: true };
  }
}

let releaseSingle: () => void = () => undefined;
const singleGate = new Promise<void>((resolve) => {
  releaseSingle = resolve;
});

/** One run at a time, no queue: a second concurrent call must be refused. */
@Agent({
  name: 'single',
  description: 'Runs one at a time',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  concurrency: { maxConcurrent: 1, queueTimeoutMs: 0 },
})
class SingleAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('single');
    await singleGate;
    return { ran: true };
  }
}

/** How many times SlowAgent.execute started. */
let slowStarts = 0;

/** Must be stopped after 50 ms. */
@Agent({
  name: 'slow',
  description: 'Takes too long',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  timeout: { executeMs: 50 },
})
class SlowAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    slowStarts += 1;
    await new Promise((resolve) => setTimeout(resolve, 2_000).unref());
    return { ran: true };
  }
}

/** One call per minute. */
@Agent({
  name: 'once',
  description: 'Runs once a minute',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  rateLimit: { maxRequests: 1, windowMs: 60_000 },
})
class OnceAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('once');
    return { ran: true };
  }
}

/**
 * Plugin extensions are declared on agents through `ExtendFrontMcpAgentMetadata`. These are
 * fields no plugin in this spec enforces, so the server starts; `approval` and `featureFlag`
 * would need their plugins (the startup check refuses them otherwise) and are covered by
 * `approval.agent.spec.ts` and `feature-flag.agent.spec.ts` with the plugins installed.
 * They are spread in untyped because no plugin augments the metadata type here.
 */
const pluginExtensions: object = { auditTag: 'finance', rolloutGroup: 'beta' };

@Agent({
  name: 'flagged',
  description: 'Declares plugin extensions',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  ...pluginExtensions,
})
class FlaggedAgent extends AgentContext {}

@App({
  id: 'ops',
  name: 'Ops',
  tools: [EdgeTool],
  agents: [EdgeOnlyAgent, EverywhereAgent, SingleAgent, SlowAgent, OnceAgent, FlaggedAgent],
})
class OpsApp {}

interface ToolCallOutcome {
  isError: boolean;
  code: unknown;
}

describe('gates an @Agent declares apply to its invoke_<agent> tool', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'agent-tool-gates', version: '1.0.0' }, apps: [OpsApp] });
  });

  beforeEach(() => {
    runs.length = 0;
  });

  async function listToolNames(): Promise<string[]> {
    const { message } = await rpc20260728(server.handler, 'tools/list');
    return ((message.result?.['tools'] as Array<{ name: string }> | undefined) ?? []).map((tool) => tool.name);
  }

  async function call(name: string): Promise<ToolCallOutcome> {
    const { message } = await rpc20260728(server.handler, 'tools/call', { name, arguments: {} });
    if (message.error) {
      return { isError: true, code: message.error.code };
    }
    const result = message.result as { isError?: boolean; _meta?: Record<string, unknown> } | undefined;
    return { isError: result?.isError === true, code: result?._meta?.['code'] };
  }

  describe('availableWhen', () => {
    it('leaves an unavailable agent out of tools/list, like an unavailable tool', async () => {
      const names = await listToolNames();

      expect({
        edgeTool: names.includes('edge_tool'),
        edgeAgent: names.includes('invoke_edge_only'),
        everywhereAgent: names.includes('invoke_everywhere'),
      }).toEqual({ edgeTool: false, edgeAgent: false, everywhereAgent: true });
    });

    it('refuses tools/call for an unavailable agent, like an unavailable tool', async () => {
      const tool = await call('edge_tool');
      const agent = await call('invoke_edge_only');

      expect(agent).toEqual(tool);
      expect(agent.isError).toBe(true);
      expect(runs).toEqual([]);
    });

    it('still runs an agent without a constraint', async () => {
      await expect(call('invoke_everywhere')).resolves.toEqual({ isError: false, code: undefined });
      expect(runs).toEqual(['everywhere']);
    });
  });

  describe('concurrency', () => {
    it('refuses a second concurrent call beyond maxConcurrent', async () => {
      const first = call('invoke_single');
      await until(() => runs.length === 1);

      const second = call('invoke_single');
      // Without the limit the second call starts too and waits on the same gate.
      const settled = await Promise.race([second, until(() => runs.length === 2).then(() => 'started')]);
      releaseSingle();
      await Promise.all([first, second]);

      expect(settled).toEqual({ isError: true, code: 'CONCURRENCY_LIMIT' });
      expect(runs).toEqual(['single']);
    });
  });

  describe('rateLimit', () => {
    it('refuses a call beyond maxRequests', async () => {
      const first = await call('invoke_once');
      const second = await call('invoke_once');

      expect([first, second]).toEqual([
        { isError: false, code: undefined },
        { isError: true, code: 'RATE_LIMIT_EXCEEDED' },
      ]);
      expect(runs).toEqual(['once']);
    });
  });

  describe('plugin extensions', () => {
    it('are copied onto invoke_<agent> so the plugins that enforce them see them', () => {
      const scope = server.instance.getScopes()[0] as Scope;
      const agentTool = scope.tools.getTools(true).find((tool) => tool.name === 'invoke_flagged');
      const metadata = agentTool?.metadata as unknown as Record<string, unknown> | undefined;

      expect({ auditTag: metadata?.['auditTag'], rolloutGroup: metadata?.['rolloutGroup'] }).toEqual({
        auditTag: 'finance',
        rolloutGroup: 'beta',
      });
    });
  });

  describe('timeout', () => {
    it('stops the agent after timeout.executeMs', async () => {
      const startedAt = Date.now();
      slowStarts = 0;
      const outcome = await call('invoke_slow');

      expect(slowStarts).toBe(1);
      expect(outcome).toEqual({ isError: true, code: 'EXECUTION_TIMEOUT' });
      expect(Date.now() - startedAt).toBeLessThan(1_500);
    });
  });
});

describe('@Agent metadata that reaches invoke_<agent>', () => {
  it('keeps every field the @Agent decorator stores on a class', () => {
    const stored = Object.keys(FrontMcpAgentTokens).filter((key) => key !== 'type' && key !== 'metadata');
    const extracted = extractAgentClassMetadata(SlowAgent) as unknown as Record<string, unknown>;

    expect(stored.filter((key) => !(key in extracted))).toEqual([]);
    expect(extracted['timeout']).toEqual({ executeMs: 50 });
    expect(extractAgentClassMetadata(EdgeOnlyAgent).availableWhen).toEqual({ runtime: ['edge'] });
  });

  it('classifies every @Agent field as agent-only or copied onto the tool', () => {
    // A new @Agent field is copied onto invoke_<agent> unless it is listed as agent-only here.
    const copied = Object.keys(frontMcpAgentMetadataSchema.shape).filter((key) => !AGENT_ONLY_METADATA_KEYS.has(key));

    expect(copied.sort()).toEqual(['availableWhen', 'concurrency', 'rateLimit', 'timeout']);
  });
});

/** Resolves once `condition` holds, or after about a second; never rejects. */
async function until(condition: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return condition();
}
