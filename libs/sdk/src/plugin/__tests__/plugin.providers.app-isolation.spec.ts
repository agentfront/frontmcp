/**
 * A plugin installed on one app contributes providers to that app only. Another app on the same
 * server, which does not install the plugin, must not resolve them from its tools, resources or
 * prompts (#678). Server-level plugins (`@FrontMcp({ plugins })`) still reach every app.
 */
import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import {
  App,
  DynamicPlugin,
  LogLevel,
  Plugin,
  Prompt,
  PromptContext,
  ProviderScope,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type ProviderType,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

class LedgerStore {
  constructor(readonly owner: string) {}
}

class LedgerSession {
  constructor(readonly owner: string) {}
}

interface LedgerOptions {
  owner: string;
}

@Plugin({ name: 'ledger' })
class LedgerPlugin extends DynamicPlugin<LedgerOptions> {
  readonly options: LedgerOptions;

  constructor(options: LedgerOptions) {
    super();
    this.options = options;
  }

  static override dynamicProviders(options: LedgerOptions): ProviderType[] {
    return [
      { name: 'ledger-store', provide: LedgerStore, useValue: new LedgerStore(options.owner) },
      {
        name: 'ledger-session',
        provide: LedgerSession,
        scope: ProviderScope.CONTEXT,
        inject: () => [] as const,
        useFactory: () => new LedgerSession(options.owner),
      },
    ];
  }
}

class AuditTrail {
  constructor(readonly owner: string) {}
}

@Plugin({ name: 'audit-trail' })
class AuditTrailPlugin extends DynamicPlugin<LedgerOptions> {
  readonly options: LedgerOptions;

  constructor(options: LedgerOptions) {
    super();
    this.options = options;
  }

  static override dynamicProviders(options: LedgerOptions): ProviderType[] {
    return [
      {
        name: 'audit-trail',
        provide: AuditTrail,
        scope: ProviderScope.CONTEXT,
        inject: () => [] as const,
        useFactory: () => new AuditTrail(options.owner),
      },
    ];
  }
}

/** What a context resolves for each token: the owner it was built for, or the error it got. */
function probe(get: <T>(token: new (...args: never[]) => T) => T): Record<string, string> {
  const out: Record<string, string> = {};
  const read = (label: string, fn: () => { owner: string }) => {
    try {
      out[label] = fn().owner;
    } catch (error) {
      out[label] = `error:${(error as Error).name}`;
    }
  };
  read('store', () => get(LedgerStore));
  read('session', () => get(LedgerSession));
  read('audit', () => get(AuditTrail));
  return out;
}

@Tool({ name: 'billing_probe', inputSchema: {} })
class BillingProbeTool extends ToolContext {
  async execute() {
    return probe((token) => this.get(token));
  }
}

@Tool({ name: 'support_probe', inputSchema: {} })
class SupportProbeTool extends ToolContext {
  async execute() {
    return probe((token) => this.get(token));
  }
}

@Resource({ name: 'support-probe', uri: 'support://probe' })
class SupportProbeResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: JSON.stringify(probe((token) => this.get(token))) }] };
  }
}

@Prompt({ name: 'support_probe_prompt', arguments: [] })
class SupportProbePrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    const text = JSON.stringify(probe((token) => this.get(token)));
    return { messages: [{ role: 'user', content: { type: 'text', text } }] };
  }
}

@App({
  id: 'billing',
  name: 'Billing',
  plugins: [LedgerPlugin.init({ owner: 'billing' })],
  tools: [BillingProbeTool],
})
class BillingApp {}

@App({
  id: 'support',
  name: 'Support',
  tools: [SupportProbeTool],
  resources: [SupportProbeResource],
  prompts: [SupportProbePrompt],
})
class SupportApp {}

const CALLER = { authContext: { sessionId: 'session-ledger', user: { sub: 'alice' } } };

describe('providers a plugin installed on one app contributes', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'ledger-isolation', version: '1.0.0' },
      apps: [BillingApp, SupportApp],
      plugins: [AuditTrailPlugin.init({ owner: 'server' })],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  async function toolProbe(name: string): Promise<Record<string, string>> {
    const result = await server.callTool(name, {}, CALLER);
    return result.structuredContent as Record<string, string>;
  }

  it('are resolved by the tools of the app that installs the plugin', async () => {
    await expect(toolProbe('billing_probe')).resolves.toEqual({
      store: 'billing',
      session: 'billing',
      audit: 'server',
    });
  });

  it('are not resolved by the tools of another app', async () => {
    const probed = await toolProbe('support_probe');
    expect(probed.store).toMatch(/^error:/);
    expect(probed.session).toMatch(/^error:/);
  });

  it('are not resolved by the resources or prompts of another app', async () => {
    const read = await server.readResource('support://probe', CALLER);
    const fromResource = JSON.parse((read.contents[0] as { text: string }).text) as Record<string, string>;
    expect(fromResource.store).toMatch(/^error:/);
    expect(fromResource.session).toMatch(/^error:/);

    const prompt = await server.getPrompt('support_probe_prompt', {}, CALLER);
    const fromPrompt = JSON.parse((prompt.messages[0].content as { text: string }).text) as Record<string, string>;
    expect(fromPrompt.store).toMatch(/^error:/);
    expect(fromPrompt.session).toMatch(/^error:/);
  });

  it('still reach every app when the plugin is installed on the server', async () => {
    const probed = await toolProbe('support_probe');
    expect(probed.audit).toBe('server');
  });
});
