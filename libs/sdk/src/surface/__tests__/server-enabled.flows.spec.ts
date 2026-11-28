/**
 * The server's `enabled` (one map from entries to their switch), `onError` on a source, and the surface hash a
 * call sends back (`_meta['frontmcp/surface']`), through the list, call, read, get and completion flows.
 */
import 'reflect-metadata';

import type { CallToolResult, GetPromptResult, ReadResourceResult } from '@frontmcp/protocol';

import {
  App,
  LogLevel,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type EnabledEntryRef,
  type EnabledOption,
  type EnabledSource,
  type FrontMcpConfigInput,
} from '../../common';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { SURFACE_META_KEY } from '../index';

class Switch implements EnabledSource {
  private readonly listeners = new Set<() => void>();
  on = true;

  constructor(
    readonly remedy?: { say: string },
    readonly onError?: 'off' | 'on',
  ) {}

  get(): boolean {
    return this.on;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(on: boolean): void {
    this.on = on;
    for (const listener of [...this.listeners]) listener();
  }
}

/** A source whose service is down: `get` throws. */
function failing(onError?: 'off' | 'on'): EnabledSource {
  return {
    get: () => {
      throw new Error('the flag service is down');
    },
    subscribe: () => () => undefined,
    ...(onError ? { onError } : {}),
  };
}

const billing = new Switch({ say: 'Turn on Billing in Settings' });
const reports = new Switch({ say: 'Turn on Reports in Settings' });
const own = new Switch({ say: 'Turn on the beta in Settings' });

const text = (uri: string): ReadResourceResult => ({ contents: [{ uri, text: `content of ${uri}` }] });
const message = (value: string): GetPromptResult => ({
  messages: [{ role: 'user', content: { type: 'text', text: value } }],
});

@Tool({ name: 'invoice_list', inputSchema: {}, tags: ['billing'] })
class InvoiceListTool extends ToolContext {
  async execute() {
    return { ran: 'invoice_list' };
  }
}

@Tool({ name: 'invoice_send', inputSchema: {}, tags: ['billing'] })
class InvoiceSendTool extends ToolContext {
  async execute() {
    return { ran: 'invoice_send' };
  }
}

@Tool({ name: 'beta_invoice', inputSchema: {}, tags: ['billing'], enabled: own })
class BetaInvoiceTool extends ToolContext {
  async execute() {
    return { ran: 'beta_invoice' };
  }
}

@Tool({ name: 'always_on', inputSchema: {} })
class AlwaysOnTool extends ToolContext {
  async execute() {
    return { ran: 'always_on' };
  }
}

@Tool({ name: 'fails_open', inputSchema: {} })
class FailsOpenTool extends ToolContext {
  async execute() {
    return { ran: 'fails_open' };
  }
}

@Tool({ name: 'fails_closed', inputSchema: {} })
class FailsClosedTool extends ToolContext {
  async execute() {
    return { ran: 'fails_closed' };
  }
}

@Tool({ name: 'own_fails_open', inputSchema: {}, enabled: failing('on') })
class OwnFailsOpenTool extends ToolContext {
  async execute() {
    return { ran: 'own_fails_open' };
  }
}

@Tool({ name: 'resolver_throws', inputSchema: {} })
class ResolverThrowsTool extends ToolContext {
  async execute() {
    return { ran: 'resolver_throws' };
  }
}

@Tool({ name: 'resolver_answers_nonsense', inputSchema: {} })
class NonsenseTool extends ToolContext {
  async execute() {
    return { ran: 'resolver_answers_nonsense' };
  }
}

@Resource({ name: 'monthly-report', uri: 'reports://monthly' })
class MonthlyReportResource extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@Resource({ name: 'status', uri: 'status://desk' })
class StatusResource extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@ResourceTemplate({ name: 'report', uriTemplate: 'reports://by-id/{reportId}' })
class ReportTemplate extends ResourceContext<{ reportId: string }> {
  async execute(uri: string) {
    return text(uri);
  }
}

@Prompt({ name: 'report-summary', arguments: [{ name: 'topic' }] })
class ReportSummaryPrompt extends PromptContext {
  async topicCompleter() {
    return { values: ['revenue'] };
  }

  async execute() {
    return message('summary');
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [
    InvoiceListTool,
    InvoiceSendTool,
    BetaInvoiceTool,
    AlwaysOnTool,
    FailsOpenTool,
    FailsClosedTool,
    OwnFailsOpenTool,
    ResolverThrowsTool,
    NonsenseTool,
  ],
  resources: [MonthlyReportResource, StatusResource, ReportTemplate],
  prompts: [ReportSummaryPrompt],
})
class DeskApp {}

const resolverCalls: EnabledEntryRef[] = [];

/** The feature map: billing by tag, reports by URI or name, and the failure cases by name. */
function featureOf(entry: EnabledEntryRef): EnabledOption | undefined {
  resolverCalls.push(entry);
  if (entry.name === 'resolver_throws') throw new Error('no feature card for it');
  if (entry.name === 'resolver_answers_nonsense') return 'yes' as unknown as boolean;
  if (entry.name === 'fails_open') return failing('on');
  if (entry.name === 'fails_closed') return failing();
  const tags = entry.metadata['tags'];
  if (entry.kind === 'tool' && Array.isArray(tags) && tags.includes('billing')) return billing;
  if (entry.uri?.startsWith('reports://') || entry.uriTemplate?.startsWith('reports://')) return reports;
  if (entry.kind === 'prompt' && entry.name.startsWith('report-')) return reports;
  return undefined;
}

const serverConfig: FrontMcpConfigInput = {
  info: { name: 'server-enabled', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
  enabled: featureOf,
};

const toolNames = async (client: DirectClient) =>
  ((await client.listTools()) as Array<{ name: string }>).map((tool) => tool.name);

const refusalOf = (pending: Promise<unknown>) =>
  pending.then(
    () => undefined,
    (error: unknown) => error as { code?: string; message?: string; data?: Record<string, unknown> },
  );

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the server's enabled", () => {
  let client: DirectClient;
  const notifications: string[] = [];

  beforeAll(async () => {
    client = await connect(serverConfig);
    client.onNotification(({ method }) => notifications.push(method));
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    billing.set(true);
    reports.set(true);
    own.set(true);
    notifications.length = 0;
  });

  it('asks once per entry, with its kind, names, URI and metadata', async () => {
    await toolNames(client);
    await client.listResources();

    const names = resolverCalls.map((entry) => `${entry.kind}:${entry.name}`);
    expect(new Set(names).size).toBe(names.length);
    expect(resolverCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool',
          name: 'invoice_list',
          fullName: expect.stringContaining('invoice_list'),
          owner: expect.objectContaining({ kind: 'app' }),
        }),
        expect.objectContaining({ kind: 'resource', name: 'monthly-report', uri: 'reports://monthly' }),
        expect.objectContaining({ kind: 'resourceTemplate', uriTemplate: 'reports://by-id/{reportId}' }),
        expect.objectContaining({ kind: 'prompt', name: 'report-summary' }),
      ]),
    );
  });

  it('turns the entries it maps to a source off and on with it, in every list', async () => {
    expect(await toolNames(client)).toEqual(expect.arrayContaining(['invoice_list', 'invoice_send', 'always_on']));

    billing.set(false);
    reports.set(false);

    const tools = await toolNames(client);
    expect(tools).not.toContain('invoice_list');
    expect(tools).not.toContain('invoice_send');
    expect(tools).toContain('always_on');
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual(['status://desk']);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
    expect((await client.listPrompts()).prompts).toEqual([]);
  });

  it('sends list_changed when a source it mapped changes', async () => {
    await pause(250);
    notifications.length = 0;

    billing.set(false);
    await pause(250);

    expect(notifications).toContain('notifications/tools/list_changed');
    expect(notifications).not.toContain('notifications/prompts/list_changed');
  });

  it("refuses an entry it turned off with FEATURE_OFF and its source's remedy", async () => {
    billing.set(false);
    reports.set(false);
    await toolNames(client);

    const call = (await client.callTool('invoice_list', {})) as CallToolResult;
    expect(call._meta).toMatchObject({ code: 'FEATURE_OFF', remedy: { say: 'Turn on Billing in Settings' } });

    const read = await refusalOf(client.readResource('reports://by-id/7'));
    expect(read?.data).toMatchObject({ code: 'FEATURE_OFF', entryType: 'ResourceTemplate' });

    const get = await refusalOf(client.getPrompt('report-summary'));
    expect(get?.data).toMatchObject({ code: 'FEATURE_OFF', entryType: 'Prompt' });

    const completion = await client.complete({
      ref: { type: 'ref/prompt', name: 'report-summary' },
      argument: { name: 'topic', value: '' },
    });
    expect(completion.completion.values).toEqual([]);
  });

  it("keeps an entry on only while its own enabled and the server's are both on", async () => {
    expect(await toolNames(client)).toContain('beta_invoice');

    own.set(false);
    expect(await toolNames(client)).not.toContain('beta_invoice');
    const ownOff = (await client.callTool('beta_invoice', {})) as CallToolResult;
    expect(ownOff._meta).toMatchObject({ code: 'FEATURE_OFF', remedy: { say: 'Turn on the beta in Settings' } });

    own.set(true);
    billing.set(false);
    expect(await toolNames(client)).not.toContain('beta_invoice');
    const serverOff = (await client.callTool('beta_invoice', {})) as CallToolResult;
    expect(serverOff._meta).toMatchObject({ code: 'FEATURE_OFF', remedy: { say: 'Turn on Billing in Settings' } });
  });

  it('turns off an entry it fails for, or answers with something enabled does not take', async () => {
    const tools = await toolNames(client);

    expect(tools).not.toContain('resolver_throws');
    expect(tools).not.toContain('resolver_answers_nonsense');
    expect(((await client.callTool('resolver_throws', {})) as CallToolResult)._meta).toMatchObject({
      code: 'FEATURE_OFF',
    });
  });

  it("counts a failing source as its onError says: off by default, on with 'on'", async () => {
    const tools = await toolNames(client);

    expect(tools).toContain('fails_open');
    expect(tools).toContain('own_fails_open');
    expect(tools).not.toContain('fails_closed');
    expect(((await client.callTool('fails_open', {})) as CallToolResult).structuredContent).toEqual({
      ran: 'fails_open',
    });
    expect(((await client.callTool('fails_closed', {})) as CallToolResult)._meta).toMatchObject({
      code: 'FEATURE_OFF',
    });
  });
});

describe('the surface hash a call sends back', () => {
  let scope: Scope;

  beforeAll(async () => {
    [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes() as Scope[];
  });

  afterAll(async () => {
    await scope.dispose();
  });

  beforeEach(() => {
    billing.set(true);
  });

  async function surfaceNow(): Promise<string> {
    const listing = await scope.runFlowForOutput('tools:list-tools', {
      request: { method: 'tools/list', params: {} },
      ctx: { authInfo: { sessionId: 'lister' } },
    });
    return listing._meta?.[SURFACE_META_KEY] as string;
  }

  /** The code a client call from a session this process never saw answers, sending `surface` back. */
  async function codeOfCall(name: string, surface?: unknown, sessionId = 'elsewhere'): Promise<string | undefined> {
    const refusal = await refusalOf(
      scope.runFlowForOutput('tools:call-tool', {
        request: {
          method: 'tools/call',
          params: { name, arguments: {}, ...(surface !== undefined ? { _meta: { [SURFACE_META_KEY]: surface } } : {}) },
        },
        ctx: { authInfo: { sessionId } },
      }),
    );
    return refusal?.code;
  }

  it('answers STALE_TOOL_LIST to a call from an older list, though this process never saw the session list', async () => {
    const before = await surfaceNow();
    billing.set(false);

    expect(await codeOfCall('invoice_list', before)).toBe('STALE_TOOL_LIST');
    expect(await codeOfCall('no_such_tool', before)).toBe('STALE_TOOL_LIST');
  });

  it('answers as usual a call from the current list, or one that sends no hash', async () => {
    billing.set(false);
    const current = await surfaceNow();

    expect(await codeOfCall('invoice_list', current)).toBe('FEATURE_OFF');
    expect(await codeOfCall('no_such_tool', current)).toBe('TOOL_NOT_FOUND');
    expect(await codeOfCall('invoice_list')).toBe('FEATURE_OFF');
  });

  it('ignores a hash that is not one', async () => {
    billing.set(false);

    expect(await codeOfCall('invoice_list', 'not-a-surface-hash')).toBe('FEATURE_OFF');
    expect(await codeOfCall('invoice_list', 42)).toBe('FEATURE_OFF');
  });

  it('lets a call from an older list run a tool that is still on', async () => {
    const before = await surfaceNow();
    billing.set(false);

    expect(await codeOfCall('always_on', before)).toBeUndefined();
  });

  it('wins over what this process remembers of a session that listed again elsewhere', async () => {
    scope.notifications.registerServer('roaming', {} as Parameters<typeof scope.notifications.registerServer>[1]);
    await scope.runFlowForOutput('tools:list-tools', {
      request: { method: 'tools/list', params: {} },
      ctx: { authInfo: { sessionId: 'roaming' } },
    });
    billing.set(false);
    scope.tools.notifyListChanged();
    const current = await surfaceNow();

    expect(await codeOfCall('invoice_list', current, 'roaming')).toBe('FEATURE_OFF');
    expect(await codeOfCall('invoice_list', undefined, 'roaming')).toBe('STALE_TOOL_LIST');
  });
});
