/**
 * Hook order across plugins with `before` / `after`, the boot check of those constraints, the dev-only
 * `_meta['frontmcp/trace']` on tool, resource and prompt answers, and per-hook `appliesTo: 'all-apps'`.
 */
import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import {
  Agent,
  AgentContext,
  App,
  DynamicPlugin,
  FlowHooksOf,
  HookPhase,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type FlowCtxOf,
  type LogRecord,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { HookOrderCycleError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');
const ReadResourceHook = FlowHooksOf('resources:read-resource');
const PromptHook = FlowHooksOf('prompts:get-prompt');

const runs: string[] = [];
const warnings: string[] = [];

@LogTransport({ name: 'OrderingWarningCapture', description: 'Keeps the warnings a server logs' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

@Plugin({ name: 'setup-gate' })
class SetupGatePlugin {
  @ToolHook.Will('execute', { priority: HookPhase.guard })
  requireSetup() {
    runs.push('setup-gate');
  }
}

/** A higher priority than the setup gate, so only `before` runs it first. */
@Plugin({ name: 'feature-gate' })
class FeatureGatePlugin {
  @ToolHook.Will('execute', { priority: HookPhase.guard + 50, before: ['setup-gate'] })
  refuseDisabled() {
    runs.push('feature-gate');
  }

  @ReadResourceHook.Will('execute')
  gateResource() {
    runs.push('feature-gate:resource');
  }

  @PromptHook.Will('execute')
  gatePrompt() {
    runs.push('feature-gate:prompt');
  }
}

@Plugin({ name: 'timer' })
class TimerPlugin {
  @ToolHook.Will('execute', { priority: HookPhase.resolve, after: ['SetupGatePlugin.requireSetup'] })
  startTimer() {
    runs.push('timer');
  }
}

@Tool({ name: 'report', inputSchema: {} })
class ReportTool extends ToolContext {
  async execute() {
    return 'report';
  }
}

@Resource({ name: 'ledger', uri: 'ledger://today' })
class LedgerResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'ledger' }] };
  }
}

@Prompt({ name: 'summary', arguments: [] })
class SummaryPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'summary' } }] };
  }
}

@App({
  id: 'billing',
  name: 'Billing',
  tools: [ReportTool],
  resources: [LedgerResource],
  prompts: [SummaryPrompt],
  plugins: [TimerPlugin, SetupGatePlugin, FeatureGatePlugin],
})
class BillingApp {}

@Tool({ name: 'plain_report', inputSchema: {} })
class PlainReportTool extends ToolContext {
  async execute() {
    return 'plain';
  }
}

@Resource({ name: 'plain-ledger', uri: 'plain://today' })
class PlainLedgerResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'plain' }] };
  }
}

@Prompt({ name: 'plain_summary', arguments: [] })
class PlainSummaryPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'plain' } }] };
  }
}

/** No plugins and no hooks: its answers run no hook, so they carry no trace. */
@App({
  id: 'plain',
  name: 'Plain',
  tools: [PlainReportTool],
  resources: [PlainLedgerResource],
  prompts: [PlainSummaryPrompt],
})
class PlainApp {}

async function serve(
  apps: Parameters<typeof FrontMcpInstance.createDirect>[0]['apps'],
  extra: Partial<Parameters<typeof FrontMcpInstance.createDirect>[0]> = {},
): Promise<DirectMcpServer> {
  return FrontMcpInstance.createDirect({
    info: { name: 'hook-ordering', version: '1.0.0' },
    apps,
    logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
    ...extra,
  });
}

describe('before / after across plugins', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    warnings.length = 0;
    server = await serve([BillingApp]);
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('runs each hook where its constraints place it, whatever its priority and plugin order', async () => {
    runs.length = 0;

    await server.callTool('report', {});

    expect(runs).toEqual(['feature-gate', 'setup-gate', 'timer']);
  });

  it('logs no warning when every constraint names a hook of its stage', () => {
    expect(warnings).toEqual([]);
  });
});

describe('the boot check of hook constraints', () => {
  @Plugin({ name: 'audit' })
  class AuditPlugin {
    @ToolHook.Will('execute', { before: ['ledger-lock'] })
    audit() {
      runs.push('audit');
    }
  }

  @Plugin({ name: 'ledger-lock' })
  class LedgerLockPlugin {
    @ToolHook.Will('execute', { before: ['audit'] })
    lock() {
      runs.push('ledger-lock');
    }
  }

  @Plugin({ name: 'cache-aware' })
  class CacheAwarePlugin {
    @ToolHook.Will('execute', { after: ['cache'] })
    read() {
      runs.push('cache-aware');
    }
  }

  it('refuses to start a server whose hooks order each other in a cycle', async () => {
    @App({ id: 'cyclic', name: 'Cyclic', tools: [ReportTool], plugins: [AuditPlugin, LedgerLockPlugin] })
    class CyclicApp {}

    await expect(serve([CyclicApp])).rejects.toThrow(HookOrderCycleError);
  });

  it("refuses to start when two apps' own hooks form a cycle, since a call naming no known tool runs both", async () => {
    @App({ id: 'audited', name: 'Audited', tools: [ReportTool], plugins: [AuditPlugin] })
    class AuditedApp {}
    @App({ id: 'locked', name: 'Locked', plugins: [LedgerLockPlugin] })
    class LockedApp {}

    await expect(serve([AuditedApp, LockedApp])).rejects.toThrow(HookOrderCycleError);
  });

  it('starts a server whose entry classes name each other, since no run sorts two entry classes together', async () => {
    @Tool({ name: 'first_entry', inputSchema: {} })
    class FirstEntryTool extends ToolContext {
      @ToolHook.Will('execute', { before: ['SecondEntryTool'] })
      note() {
        runs.push('first-entry');
      }

      async execute() {
        return 'first';
      }
    }

    @Tool({ name: 'second_entry', inputSchema: {} })
    class SecondEntryTool extends ToolContext {
      @ToolHook.Will('execute', { before: ['FirstEntryTool'] })
      note() {
        runs.push('second-entry');
      }

      async execute() {
        return 'second';
      }
    }

    @App({ id: 'entries', name: 'Entries', tools: [FirstEntryTool, SecondEntryTool] })
    class EntriesApp {}

    const server = await serve([EntriesApp]);
    runs.length = 0;
    await server.callTool('first_entry', {});
    await server.dispose();

    expect(runs).toEqual(['first-entry']);
  });

  describe('of an agent that inherits the plugins of its app', () => {
    const answering = { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) };

    @Plugin({ name: 'deck-log' })
    class DeckLogPlugin {
      @ToolHook.Will('execute', { after: ['setup-gate'] })
      log() {
        runs.push('deck-log');
      }
    }

    @Plugin({ name: 'deck-lock' })
    class DeckLockPlugin {
      @ToolHook.Will('execute', { before: ['setup-gate'], after: ['setup-gate'] })
      lock() {
        runs.push('deck-lock');
      }
    }

    function deckApp(plugin: typeof DeckLogPlugin | typeof DeckLockPlugin) {
      @Agent({
        name: 'deckhand',
        inputSchema: {},
        llm: { adapter: answering },
        tools: [ReportTool],
        plugins: [plugin],
        execution: { inheritPlugins: true },
      })
      class DeckhandAgent extends AgentContext {}

      @App({ id: 'deck', name: 'Deck', plugins: [SetupGatePlugin], agents: [DeckhandAgent] })
      class DeckApp {}
      return DeckApp;
    }

    it('matches the targets of its own hooks against the hooks it inherits', async () => {
      warnings.length = 0;

      const server = await serve([deckApp(DeckLogPlugin)]);
      await server.dispose();

      expect(warnings.filter((message) => message.includes("names 'setup-gate'"))).toEqual([]);
    });

    it('refuses to start when its own hooks and the ones it inherits form a cycle', async () => {
      await expect(serve([deckApp(DeckLockPlugin)])).rejects.toThrow(HookOrderCycleError);
    });
  });

  it('warns once at boot about a target no hook of the stage matches', async () => {
    @App({ id: 'lonely', name: 'Lonely', tools: [ReportTool], plugins: [CacheAwarePlugin] })
    class LonelyApp {}
    warnings.length = 0;

    const server = await serve([LonelyApp]);
    await server.callTool('report', {});
    await server.callTool('report', {});
    await server.dispose();

    expect(warnings.filter((message) => message.includes("names 'cache' in after"))).toHaveLength(1);
  });
});

describe('the dev hook trace in _meta', () => {
  const { NODE_ENV } = process.env;

  afterEach(() => {
    process.env['NODE_ENV'] = NODE_ENV;
  });

  async function answersIn(
    nodeEnv: string,
    devtools?: { hookTrace?: boolean },
  ): Promise<{ tool: unknown; resource: unknown; prompt: unknown }> {
    process.env['NODE_ENV'] = nodeEnv;
    const server = await serve([BillingApp], devtools ? { devtools } : {});
    try {
      const tool = await server.callTool('report', {});
      const resource = await server.readResource('ledger://today');
      const prompt = await server.getPrompt('summary', {});
      return {
        tool: tool._meta?.['frontmcp/trace'],
        resource: resource._meta?.['frontmcp/trace'],
        prompt: prompt._meta?.['frontmcp/trace'],
      };
    } finally {
      await server.dispose();
    }
  }

  it('lists the hooks of a tool call in run order in dev mode, with their owner, stage, type, time and outcome', async () => {
    const { tool } = await answersIn('development');

    expect(tool).toEqual([
      {
        owner: 'feature-gate',
        method: 'refuseDisabled',
        stage: 'execute',
        type: 'will',
        ms: expect.any(Number),
        outcome: 'ok',
      },
      {
        owner: 'setup-gate',
        method: 'requireSetup',
        stage: 'execute',
        type: 'will',
        ms: expect.any(Number),
        outcome: 'ok',
      },
      { owner: 'timer', method: 'startTimer', stage: 'execute', type: 'will', ms: expect.any(Number), outcome: 'ok' },
    ]);
  });

  it('is on resource and prompt answers too', async () => {
    const { resource, prompt } = await answersIn('development');

    expect(resource).toEqual([expect.objectContaining({ owner: 'feature-gate', method: 'gateResource' })]);
    expect(prompt).toEqual([expect.objectContaining({ owner: 'feature-gate', method: 'gatePrompt' })]);
  });

  it('is never there outside dev mode', async () => {
    await expect(answersIn('production')).resolves.toEqual({ tool: undefined, resource: undefined, prompt: undefined });
    await expect(answersIn('test')).resolves.toEqual({ tool: undefined, resource: undefined, prompt: undefined });
  });

  it('is there outside dev mode with devtools.hookTrace, and not in dev mode with devtools.hookTrace: false', async () => {
    const enabled = await answersIn('production', { hookTrace: true });
    const disabled = await answersIn('development', { hookTrace: false });

    expect(enabled.tool).toHaveLength(3);
    expect(disabled).toEqual({ tool: undefined, resource: undefined, prompt: undefined });
  });

  it('adds no trace key, and so no _meta, to the answers of a server that runs no hook, in dev mode or with devtools.hookTrace', async () => {
    for (const [nodeEnv, devtools] of [
      ['development', undefined],
      ['production', { hookTrace: true }],
    ] as const) {
      process.env['NODE_ENV'] = nodeEnv;
      const server = await serve([PlainApp], devtools ? { devtools } : {});
      try {
        const tool = await server.callTool('plain_report', {});
        const resource = await server.readResource('plain://today');
        const prompt = await server.getPrompt('plain_summary', {});

        expect(tool).not.toHaveProperty('_meta');
        expect(resource).toEqual({ contents: [{ uri: 'plain://today', text: 'plain' }] });
        expect(prompt).not.toHaveProperty('_meta');
      } finally {
        await server.dispose();
      }
    }
  });

  it('refuses a devtools.hookTrace that is not a boolean', async () => {
    await expect(serve([BillingApp], { devtools: { hookTrace: 'yes' as unknown as boolean } })).rejects.toThrow(
      'devtools.hookTrace',
    );
  });
});

describe("appliesTo: 'all-apps'", () => {
  interface StampOptions {
    label: string;
  }

  @Plugin({ name: 'stamp' })
  class StampPlugin extends DynamicPlugin<StampOptions> {
    readonly options: StampOptions;

    constructor(options: StampOptions) {
      super();
      this.options = options;
    }

    @ToolHook.Will('execute', { appliesTo: 'all-apps' })
    stamp(ctx: FlowCtxOf<'tools:call-tool'>) {
      runs.push(`${this.options.label}:${ctx.toolName}`);
    }

    @ToolHook.Will('execute')
    ownAppOnly(ctx: FlowCtxOf<'tools:call-tool'>) {
      runs.push(`${this.options.label}-own:${ctx.toolName}`);
    }
  }

  function toolNamed(name: string) {
    @Tool({ name, inputSchema: {} })
    class NamedTool extends ToolContext {
      async execute() {
        return 'ok';
      }
    }
    return NamedTool;
  }

  @App({
    id: 'alpha',
    name: 'Alpha',
    tools: [toolNamed('alpha_tool')],
    plugins: [StampPlugin.init({ label: 'alpha' })],
  })
  class AlphaApp {}

  @App({ id: 'beta', name: 'Beta', tools: [toolNamed('beta_tool')] })
  class BetaApp {}

  @App({
    id: 'gamma',
    name: 'Gamma',
    tools: [toolNamed('gamma_tool')],
    plugins: [StampPlugin.init({ label: 'gamma' })],
  })
  class GammaApp {}

  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await serve([AlphaApp, BetaApp, GammaApp]);
  });

  afterAll(async () => {
    await server.dispose();
  });

  async function hooksFor(toolName: string): Promise<string[]> {
    runs.length = 0;
    await server.callTool(toolName, {});
    return [...runs].sort();
  }

  it("runs one app's hook for every other app's entries, and its own-app hooks for its app only", async () => {
    expect(await hooksFor('beta_tool')).toEqual(['alpha:beta_tool', 'gamma:beta_tool']);
    expect(await hooksFor('alpha_tool')).toEqual(['alpha-own:alpha_tool', 'alpha:alpha_tool', 'gamma:alpha_tool']);
  });
});
