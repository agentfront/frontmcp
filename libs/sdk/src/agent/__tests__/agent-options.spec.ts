/**
 * `@Agent` options that were accepted and then ignored (#678), and the function-style `agent()`.
 *
 * - `agent(options)(handler)`: the handler never ran. The agent's context called the function
 *   `agent()` returned, which only hands the handler back, so the call returned that function and
 *   failed output validation with a list of Zod issues.
 * - `execution.inheritParentTools` and `execution.inheritPlugins` changed nothing: the model was
 *   only ever sent the agent's own tools, and those only ran the agent's own plugins' hooks.
 * - `exports` exported nothing: an exported prompt or resource never reached `prompts/list` or
 *   `resources/list`, and an exported provider never reached the app.
 * - `execution.enableStreaming`, and resources and prompts that are not exported, were reported at
 *   startup until the agent streamed its reply (#698) and its model could read them (#699).
 * - An `executeTool()` override never saw the model's tool calls.
 * - The agent's options are `this.metadata` (there is no `this.options`).
 */
import 'reflect-metadata';

import { inspect } from 'node:util';

import { z } from '@frontmcp/lazy-zod';

import {
  agent,
  Agent,
  AgentContext,
  App,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Prompt,
  PromptContext,
  Provider,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type AgentPrompt,
  type AgentToolDefinition,
  type FlowCtxOf,
  type LogRecord,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { AgentConfigurationError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');

const runs: string[] = [];
const offered: Record<string, string[][]> = {};
const logLines: string[] = [];

@LogTransport({ name: 'AgentOptionsCapture', description: 'Captures log lines for assertions' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    logLines.push(
      [record.message, ...record.args].map((value) => (typeof value === 'string' ? value : inspect(value))).join(' '),
    );
  }
}

/** An LLM that calls `toolName` once, then answers with what the tool returned. */
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

const answering = { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) };

/** Installed on the app: records the tools whose `tools:call-tool` flow it hooks. */
@Plugin({ name: 'harbor-audit' })
class HarborAuditPlugin {
  @ToolHook.Will('execute')
  audit(ctx: FlowCtxOf<'tools:call-tool'>) {
    runs.push(`audit:${ctx.state.tool?.name}`);
  }
}

@Tool({ name: 'ledger_balance', inputSchema: {} })
class LedgerBalanceTool extends ToolContext {
  async execute() {
    runs.push('ledger_balance ran');
    return { balance: 120 };
  }
}

@Tool({ name: 'crate_count', inputSchema: {} })
class CrateCountTool extends ToolContext {
  async execute() {
    runs.push('crate_count ran');
    return { crates: 7 };
  }
}

// ---------------------------------------------------------------- agent() function style

const echoAgent = agent({
  name: 'echo_fn',
  inputSchema: { message: z.string() },
  llm: { adapter: answering },
})((input, ctx) => ({
  echoed: `Echo: ${input.message}`,
  agent: (ctx as unknown as AgentContext).metadata.name,
}));

// ---------------------------------------------------------------- this.metadata

@Agent({
  name: 'introspector',
  inputSchema: {},
  llm: { adapter: answering },
  swarm: { canSeeOtherAgents: true },
  execution: { maxIterations: 4 },
})
class IntrospectorAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    return { swarm: this.metadata.swarm, maxIterations: this.metadata.execution?.maxIterations };
  }
}

// ---------------------------------------------------------------- inheritParentTools

@Agent({
  name: 'heir',
  inputSchema: {},
  llm: { adapter: callingModel('heir', 'ledger_balance') },
  tools: [CrateCountTool],
  execution: { inheritParentTools: true },
})
class HeirAgent extends AgentContext {}

@Agent({
  name: 'stranger',
  inputSchema: {},
  llm: { adapter: callingModel('stranger', 'ledger_balance') },
  tools: [CrateCountTool],
})
class StrangerAgent extends AgentContext {}

// ---------------------------------------------------------------- inheritPlugins

/** Installed on agents: records the tools whose `tools:call-tool` flow it hooks. */
@Plugin({ name: 'deck-audit' })
class DeckAuditPlugin {
  @ToolHook.Will('execute')
  audit(ctx: FlowCtxOf<'tools:call-tool'>) {
    runs.push(`deck-audit:${ctx.state.tool?.name}`);
  }
}

/** Has the app's plugin installed itself too: its hook must run once per call, not twice. */
@Agent({
  name: 'layered',
  inputSchema: {},
  llm: { adapter: callingModel('layered', 'crate_count') },
  tools: [CrateCountTool],
  plugins: [DeckAuditPlugin, HarborAuditPlugin],
  execution: { inheritPlugins: true },
})
class LayeredAgent extends AgentContext {}

@Agent({
  name: 'plugin_heir',
  inputSchema: {},
  llm: { adapter: callingModel('plugin_heir', 'crate_count') },
  tools: [CrateCountTool],
  execution: { inheritPlugins: true },
})
class PluginHeirAgent extends AgentContext {}

@Agent({
  name: 'plugin_isolated',
  inputSchema: {},
  llm: { adapter: callingModel('plugin_isolated', 'crate_count') },
  tools: [CrateCountTool],
})
class PluginIsolatedAgent extends AgentContext {}

// ---------------------------------------------------------------- providers

/** Provided by the `quartermaster` agent only, not by its app. */
@Provider({ name: 'stores' })
class Stores {
  count(): number {
    return 12;
  }
}

@Tool({ name: 'count_stores', inputSchema: {} })
class CountStoresTool extends ToolContext {
  async execute() {
    return { stores: this.get(Stores).count() };
  }
}

@Agent({
  name: 'quartermaster',
  inputSchema: {},
  llm: { adapter: callingModel('quartermaster', 'count_stores') },
  providers: [Stores],
  tools: [CountStoresTool],
})
class QuartermasterAgent extends AgentContext {}

// ---------------------------------------------------------------- exports

@Provider({ name: 'shelf-catalog' })
class ShelfCatalog {
  size(): number {
    return 3;
  }
}

@Resource({ name: 'shelf', uri: 'library://shelf', mimeType: 'text/plain' })
class ShelfResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'three books' }] };
  }
}

@Prompt({ name: 'greeting', arguments: [{ name: 'visitor', required: true }] })
class GreetingPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return {
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Welcome, ${args['visitor']}` } }],
    };
  }
}

@Prompt({ name: 'staff_only', arguments: [] })
class StaffOnlyPrompt extends PromptContext {
  async execute() {
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'staff' } }] };
  }
}

@Agent({
  name: 'librarian',
  inputSchema: {},
  llm: { adapter: answering },
  providers: [ShelfCatalog],
  resources: [ShelfResource],
  prompts: [GreetingPrompt, StaffOnlyPrompt],
  exports: { resources: '*', prompts: [GreetingPrompt], providers: [ShelfCatalog] },
})
class LibrarianAgent extends AgentContext {}

/** Reads a provider the librarian agent exports to the app. */
@Tool({ name: 'catalog_size', inputSchema: {} })
class CatalogSizeTool extends ToolContext {
  async execute() {
    return { size: this.get(ShelfCatalog).size() };
  }
}

// ---------------------------------------------------------------- startup warnings, executeTool()

@Agent({ name: 'streamer', inputSchema: {}, llm: { adapter: answering }, execution: { enableStreaming: true } })
class StreamerAgent extends AgentContext {}

const executedByOverride: string[] = [];

@Agent({
  name: 'overseer',
  inputSchema: {},
  llm: { adapter: callingModel('overseer', 'crate_count') },
  tools: [CrateCountTool],
})
class OverseerAgent extends AgentContext {
  protected override async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    executedByOverride.push(name);
    return super.executeTool(name, args);
  }
}

@App({
  id: 'harbor',
  name: 'Harbor',
  tools: [LedgerBalanceTool, CatalogSizeTool],
  plugins: [HarborAuditPlugin],
  agents: [
    echoAgent,
    IntrospectorAgent,
    HeirAgent,
    StrangerAgent,
    PluginHeirAgent,
    PluginIsolatedAgent,
    LayeredAgent,
    QuartermasterAgent,
    LibrarianAgent,
    StreamerAgent,
    OverseerAgent,
  ],
})
class HarborApp {}

describe('@Agent options', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'agent-options', version: '1.0.0' },
      apps: [HarborApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
  });

  describe('agent(options)(handler)', () => {
    it('runs the handler with the input and the agent context', async () => {
      const result = await server.callTool('invoke_echo_fn', { message: 'ahoy' });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ echoed: 'Echo: ahoy', agent: 'echo_fn' });
    });
  });

  describe('this.metadata', () => {
    it("holds the agent's options, with their defaults", async () => {
      const result = await server.callTool('invoke_introspector', {});

      expect(result.structuredContent).toEqual({
        swarm: { canSeeOtherAgents: true, isVisible: true, maxCallDepth: 3 },
        maxIterations: 4,
      });
    });
  });

  describe('execution.inheritParentTools', () => {
    it("offers the model the tools of the agent's scope too, other than agents, and runs them through that scope", async () => {
      const result = await server.callTool('invoke_heir', {});
      const names = offered['heir']?.[0] ?? [];

      expect(names).toEqual(expect.arrayContaining(['crate_count', 'ledger_balance', 'catalog_size']));
      expect(names.filter((name) => name.startsWith('invoke_'))).toEqual([]);
      // The app's plugin hooks the agent's own invoke_ tool and, since ledger_balance ran through the
      // app's tools:call-tool flow, that call too
      expect(runs).toEqual(['audit:invoke_heir', 'audit:ledger_balance', 'ledger_balance ran']);
      expect(result.structuredContent).toEqual({ balance: 120 });
    });

    it("offers only the agent's own tools by default", async () => {
      await server.callTool('invoke_stranger', {});

      expect(offered['stranger']?.[0]).toEqual(['crate_count']);
      expect(runs).toEqual(['audit:invoke_stranger']);
    });
  });

  describe('execution.inheritPlugins', () => {
    it("runs the app's plugin hooks for the agent's own tools", async () => {
      await server.callTool('invoke_plugin_heir', {});

      expect(runs).toEqual(['audit:invoke_plugin_heir', 'audit:crate_count', 'crate_count ran']);
    });

    it("runs only the agent's own plugins by default", async () => {
      await server.callTool('invoke_plugin_isolated', {});

      expect(runs).toEqual(['audit:invoke_plugin_isolated', 'crate_count ran']);
    });

    it('runs a plugin installed both on the agent and its app once, as the agent installed it', async () => {
      await server.callTool('invoke_layered', {});

      expect(runs).toEqual(['audit:invoke_layered', 'deck-audit:crate_count', 'audit:crate_count', 'crate_count ran']);
    });

    it("orders the inherited hooks with the agent's own by priority, the agent's own first among equals", async () => {
      // A Will hook of a lower priority runs first, as it does among an app's own hooks
      @Plugin({ name: 'early-audit' })
      class EarlyAuditPlugin {
        @ToolHook.Will('execute', { priority: 5 })
        audit(ctx: FlowCtxOf<'tools:call-tool'>) {
          runs.push(`early:${ctx.state.tool?.name}`);
        }
      }

      @Plugin({ name: 'late-audit' })
      class LateAuditPlugin {
        @ToolHook.Will('execute')
        audit(ctx: FlowCtxOf<'tools:call-tool'>) {
          runs.push(`late:${ctx.state.tool?.name}`);
        }
      }

      @Agent({
        name: 'ordered',
        inputSchema: {},
        llm: { adapter: callingModel('ordered', 'crate_count') },
        tools: [CrateCountTool],
        plugins: [DeckAuditPlugin],
        execution: { inheritPlugins: true },
      })
      class OrderedAgent extends AgentContext {}

      @App({ id: 'dock', name: 'Dock', plugins: [LateAuditPlugin, EarlyAuditPlugin], agents: [OrderedAgent] })
      class DockApp {}

      const dock = await FrontMcpInstance.createDirect({
        info: { name: 'agent-inherit-order', version: '1.0.0' },
        apps: [DockApp],
        logging: { level: LogLevel.Off },
      });
      try {
        await dock.callTool('invoke_ordered', {});
      } finally {
        await dock.dispose();
      }

      expect(runs).toEqual([
        'late:invoke_ordered',
        'early:invoke_ordered',
        'deck-audit:crate_count',
        'late:crate_count',
        'early:crate_count',
        'crate_count ran',
      ]);
    });
  });

  describe('providers', () => {
    it("are provided to the agent's tools without being registered in its app", async () => {
      const result = await server.callTool('invoke_quartermaster', {});

      expect(result.structuredContent).toEqual({ stores: 12 });
    });
  });

  describe('exports', () => {
    it('lists and serves the exported resources', async () => {
      const { resources } = await server.listResources();
      const read = await server.readResource('library://shelf');

      expect(resources.map((resource) => resource.uri)).toContain('library://shelf');
      expect(read.contents).toEqual([expect.objectContaining({ uri: 'library://shelf', text: 'three books' })]);
    });

    it('lists and serves the exported prompts, and only those', async () => {
      const { prompts } = await server.listPrompts();
      const greeting = await server.getPrompt('greeting', { visitor: 'Ada' });

      expect(prompts.map((prompt) => prompt.name)).toEqual(['greeting']);
      expect(greeting.messages).toEqual([{ role: 'user', content: { type: 'text', text: 'Welcome, Ada' } }]);
    });

    it("gives the app's entries the exported providers", async () => {
      const result = await server.callTool('catalog_size', {});

      expect(result.structuredContent).toEqual({ size: 3 });
    });

    it('refuses to start when an export is not one of the agent own entries', async () => {
      @Agent({
        name: 'boaster',
        inputSchema: {},
        llm: { adapter: answering },
        prompts: [GreetingPrompt],
        exports: { prompts: [StaffOnlyPrompt] },
      })
      class BoasterAgent extends AgentContext {}

      @App({ id: 'boast', name: 'Boast', agents: [BoasterAgent] })
      class BoastApp {}

      const start = FrontMcpInstance.createDirect({
        info: { name: 'agent-bad-export', version: '1.0.0' },
        apps: [BoastApp],
        logging: { level: LogLevel.Off },
      });

      await expect(start).rejects.toBeInstanceOf(AgentConfigurationError);
      await expect(start).rejects.toThrow(
        'Agent "boaster" exports prompts "StaffOnlyPrompt", which is not one of its own prompts (`prompts: [...]`)',
      );
    });

    it.each([
      ['resources', { resources: [ShelfResource] }, 'resources "ShelfResource"'],
      ['a provider token', { providers: [{ provide: 'SHELF_TOKEN', useValue: 1 }] }, 'providers "SHELF_TOKEN"'],
      ['a provider symbol', { providers: [{ provide: Symbol('shelf'), useValue: 1 }] }, 'providers "shelf"'],
    ])('refuses to start when it exports %s it does not declare', async (_kind, exportsConfig, named) => {
      @Agent({ name: 'pretender', inputSchema: {}, llm: { adapter: answering }, exports: exportsConfig as never })
      class PretenderAgent extends AgentContext {}

      @App({ id: 'pretend', name: 'Pretend', agents: [PretenderAgent] })
      class PretendApp {}

      await expect(
        FrontMcpInstance.createDirect({
          info: { name: 'agent-bad-export', version: '1.0.0' },
          apps: [PretendApp],
          logging: { level: LogLevel.Off },
        }),
      ).rejects.toThrow(`Agent "pretender" exports ${named}, which is not one of its own`);
    });

    it('exports the resources it lists', async () => {
      @Agent({
        name: 'archivist',
        inputSchema: {},
        llm: { adapter: answering },
        resources: [ShelfResource],
        exports: { resources: [ShelfResource] },
      })
      class ArchivistAgent extends AgentContext {}

      @App({ id: 'archive', name: 'Archive', agents: [ArchivistAgent] })
      class ArchiveApp {}

      const archive = await FrontMcpInstance.createDirect({
        info: { name: 'agent-export-list', version: '1.0.0' },
        apps: [ArchiveApp],
        logging: { level: LogLevel.Off },
      });
      try {
        const { resources } = await archive.listResources();
        expect(resources.map((resource) => resource.uri)).toEqual(['library://shelf']);
      } finally {
        await archive.dispose();
      }
    });
  });

  describe('startup warnings', () => {
    it('does not report execution.enableStreaming, which streams the reply (#698)', () => {
      expect(logLines.filter((line) => line.includes('Agent "streamer"'))).toEqual([]);
    });

    it('does not report resources or prompts that are not exported: the agent model reads them', () => {
      expect(logLines.filter((line) => line.includes('Agent "librarian"'))).toEqual([]);
    });
  });

  describe('an AgentContext built without an agent instance', () => {
    class BareAgent extends AgentContext {
      callInvokeAgent(agentId: string) {
        return this.invokeAgent(agentId, {});
      }

      callExecuteTool(name: string) {
        return this.executeTool(name, {});
      }
    }

    const logger = { child: () => logger, info: () => undefined, debug: () => undefined } as never;
    const bare = new BareAgent({
      metadata: { name: 'bare', llm: { adapter: answering } } as never,
      input: {},
      providers: {} as never,
      logger,
      authInfo: {} as never,
      llmAdapter: answering as never,
    });

    it('cannot invoke agents or run tools', async () => {
      await expect(bare.callInvokeAgent('researcher')).rejects.toThrow(
        'Agent method "invokeAgent" is not available on "bare"',
      );
      await expect(bare.callExecuteTool('crate_count')).rejects.toThrow(
        'Agent method "executeTool" is not available on "bare"',
      );
    });
  });

  describe('executeTool()', () => {
    it("sees every tool call of the agent's model when overridden", async () => {
      const result = await server.callTool('invoke_overseer', {});

      expect(executedByOverride).toEqual(['crate_count']);
      expect(result.structuredContent).toEqual({ crates: 7 });
    });
  });
});
