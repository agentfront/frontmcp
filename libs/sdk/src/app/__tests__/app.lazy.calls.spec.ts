/** A call to a lazy app's entry imports and initializes the app once, then runs through the normal flow. */
import 'reflect-metadata';

import {
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  Skill,
  Tool,
  ToolContext,
  type EnabledSource,
  type FlowCtxOf,
  type FrontMcpConfigInput,
} from '../../common';
import type { DirectClient } from '../../direct/client.types';
import { connect } from '../../direct/connect';
import { buildManifest } from '../../manifest/build-manifest';
import type { ServerManifest } from '../../manifest/server-manifest.schema';
import {
  BillingApp,
  billingAudit,
  BillingAuditPlugin,
  billingEntries,
  billingImport,
  billingLifecycle,
  capturedLogs,
  lazyServer,
} from './lazy-app.fixtures';

let manifest: ServerManifest;

beforeAll(async () => {
  manifest = await buildManifest(lazyServer(billingImport()));
});

function textOf(result: unknown): string {
  return JSON.stringify(result);
}

/** An `enabled` source a test turns on and off. */
function switchSource(initial: boolean): EnabledSource & { set(value: boolean): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: boolean) {
      value = next;
      for (const listener of listeners) listener();
    },
    remedy: { say: 'Turn on billing in the settings.' },
  };
}

describe('calls to a lazy app', () => {
  const clients: DirectClient[] = [];
  const open = async (lazy: () => Promise<unknown>, extra: Partial<FrontMcpConfigInput> = {}, app = {}) => {
    const client = await connect(lazyServer(lazy, { manifest, ...extra }, app));
    clients.push(client);
    return client;
  };

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    billingAudit.length = 0;
    billingLifecycle.length = 0;
    capturedLogs.length = 0;
  });

  it('imports and initializes the app on the first call, and runs the call with its plugin hooks', async () => {
    const lazy = billingImport();
    const client = await open(lazy);
    await client.listTools();
    expect(lazy).not.toHaveBeenCalled();

    const result = await client.callTool('charge', { customer: 'acme', cents: 250 });

    expect(lazy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ structuredContent: { receipt: 'R-acme', cents: 250 } }));
    expect(result).not.toHaveProperty('isError', true);
    expect(billingAudit).toEqual(['call']);
    expect(billingLifecycle).toEqual(['ready']);
  });

  it('runs the authorization stages on the loaded tool, not on its placeholder', async () => {
    const authorized: string[] = [];

    @Plugin({ name: 'authorization-probe' })
    class AuthorizationProbePlugin {
      @(FlowHooksOf('tools:call-tool').Will('checkToolAuthorization'))
      probe(ctx: FlowCtxOf<'tools:call-tool'>) {
        authorized.push((ctx.state.tool?.record.provide as { name?: string } | undefined)?.name ?? 'none');
      }
    }

    const client = await open(billingImport(), { plugins: [AuthorizationProbePlugin] });
    await client.callTool('charge', { customer: 'acme', cents: 1 });

    expect(authorized).toEqual(['ChargeTool']);
  });

  it("fits the loaded tool's answer to the answer budget", async () => {
    const client = await open(billingImport(), { output: { budget: { maxBytes: 2_000 } } });

    const result = await client.callTool('ledger', { count: 200 });

    expect(textOf(result)).toMatch(/shortened to fit its 2000-byte budget/);
  });

  it('imports the app once for concurrent first calls', async () => {
    const lazy = billingImport();
    const client = await open(lazy);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) => client.callTool('charge', { customer: `c${index}`, cents: index })),
    );

    expect(lazy).toHaveBeenCalledTimes(1);
    expect(results.map((result) => textOf(result))).toEqual(
      Array.from({ length: 5 }, (_, index) => expect.stringContaining(`R-c${index}`)),
    );
    expect(billingAudit).toHaveLength(5);
  });

  it('resolves an alias of a lazy tool to the loaded tool', async () => {
    const lazy = billingImport();
    const client = await open(lazy);

    const result = await client.callTool('billing.charge', { customer: 'acme', cents: 1 });

    expect(textOf(result)).toContain('R-acme');
    expect(lazy).toHaveBeenCalledTimes(1);
  });

  it("validates the answer against the loaded tool's output schema", async () => {
    const client = await open(billingImport());

    const result = await client.callTool('balance', {});

    expect(result).toEqual(expect.objectContaining({ isError: true }));
  });

  it('reads a lazy resource and a lazy resource template, and gets a lazy prompt', async () => {
    const lazy = billingImport();
    const client = await open(lazy);

    const plans = await client.readResource('billing://plans');
    const invoice = await client.readResource('billing://invoices/42');
    const prompt = await client.getPrompt('dunning', { customer: 'acme' });

    expect(plans.contents[0]).toEqual(expect.objectContaining({ text: '["free","pro"]' }));
    expect(invoice.contents[0]).toEqual(expect.objectContaining({ text: '{"id":"42"}' }));
    expect(textOf(prompt.messages)).toContain('Remind acme');
    expect(lazy).toHaveBeenCalledTimes(1);
  });

  it('refuses an entry the manifest lists as off with FEATURE_OFF, without importing the app', async () => {
    const lazy = billingImport();
    const client = await open(lazy);

    const result = await client.callTool('invoice_export', {});

    expect(textOf(result)).toContain('FEATURE_OFF');
    expect(lazy).not.toHaveBeenCalled();
  });

  it('never imports an app whose enabled is false, and refuses its entries with FEATURE_OFF', async () => {
    const lazy = billingImport();
    const client = await open(lazy, {}, { enabled: false });

    const tools = await client.listTools();
    const result = await client.callTool('charge', { customer: 'acme', cents: 1 });

    expect(textOf(tools)).not.toContain('charge');
    expect(textOf(result)).toContain('FEATURE_OFF');
    await expect(client.readResource('billing://plans')).rejects.toThrow(/turned off/);
    expect(lazy).not.toHaveBeenCalled();
  });

  it('follows an enabled source: off, never imported; on, imported; off again, hidden and refused', async () => {
    const lazy = billingImport();
    const feature = switchSource(false);
    const client = await open(lazy, {}, { enabled: feature });

    expect(textOf(await client.listTools())).not.toContain('charge');
    const refused = await client.callTool('charge', { customer: 'acme', cents: 1 });
    expect(textOf(refused)).toContain('Turn on billing in the settings.');
    expect(lazy).not.toHaveBeenCalled();

    feature.set(true);
    expect(textOf(await client.listTools())).toContain('charge');
    expect(textOf(await client.callTool('charge', { customer: 'acme', cents: 1 }))).toContain('R-acme');
    expect(lazy).toHaveBeenCalledTimes(1);

    feature.set(false);
    expect(textOf(await client.listTools())).not.toContain('charge');
    expect(textOf(await client.callTool('charge', { customer: 'acme', cents: 1 }))).toContain('FEATURE_OFF');
  });

  it('answers a failed import with a typed error and a remedy, and imports again on the next call', async () => {
    const lazy = jest
      .fn<Promise<unknown>, []>()
      .mockRejectedValueOnce(new Error('Cannot find module ./billing.app'))
      .mockResolvedValue({ BillingApp });
    const client = await open(lazy);

    const failed = await client.callTool('charge', { customer: 'acme', cents: 1 });
    const pinged = await client.callTool('ping', {});
    const retried = await client.callTool('charge', { customer: 'acme', cents: 1 });

    expect(failed).toEqual(expect.objectContaining({ isError: true }));
    expect(textOf(failed)).toContain('LAZY_APP_LOAD_FAILED');
    expect(textOf(failed)).toMatch(/App \\"Billing\\" could not be loaded/);
    expect(textOf(failed)).toContain('remedy');
    expect(textOf(failed)).not.toContain('Cannot find module');
    expect(textOf(pinged)).toContain('pong');
    expect(textOf(retried)).toContain('R-acme');
    expect(lazy).toHaveBeenCalledTimes(2);
    expect(capturedLogs.map(({ message }) => message)).toContainEqual(
      expect.stringContaining('Cannot find module ./billing.app'),
    );
  });

  it('does not import again after an app failed part-way through initializing, and says to restart', async () => {
    @Skill({ name: 'refunds', description: 'How to refund', instructions: 'Refund within 30 days.' })
    class RefundsSkill {}

    @App({
      id: 'billing',
      name: 'Billing',
      plugins: [BillingAuditPlugin],
      skills: [RefundsSkill],
      tools: [billingEntries.ChargeTool],
    })
    class SkilledBillingApp {}

    const lazy = billingImport({ SkilledBillingApp });
    const client = await open(lazy);

    const first = await client.callTool('charge', { customer: 'acme', cents: 1 });
    const second = await client.callTool('charge', { customer: 'acme', cents: 1 });

    expect(textOf(first)).toContain('restart the server');
    expect(textOf(second)).toContain('LAZY_APP_LOAD_FAILED');
    expect(lazy).toHaveBeenCalledTimes(1);
    expect(capturedLogs.map(({ message }) => message)).toContainEqual(
      expect.stringMatching(/App "billing" could not be loaded \(restart the server.*cannot be lazy: it has skills/),
    );
  });

  it('imports the app for a completion of its prompt', async () => {
    const lazy = billingImport();
    const client = await open(lazy);

    await client.complete({ ref: { type: 'ref/prompt', name: 'dunning' }, argument: { name: 'customer', value: 'a' } });

    expect(lazy).toHaveBeenCalledTimes(1);
  });

  it('answers a failed resource read and prompt get with the same typed error', async () => {
    const lazy = jest.fn<Promise<unknown>, []>().mockRejectedValue(new Error('disk on fire'));
    const client = await open(lazy);

    await expect(client.readResource('billing://plans')).rejects.toThrow(/App "Billing" could not be loaded/);
    await expect(client.getPrompt('dunning', { customer: 'acme' })).rejects.toThrow(/could not be loaded/);
    expect(lazy).toHaveBeenCalledTimes(2);
  });
});

const APPROVAL: Record<string, unknown> = { approval: true };

@Plugin({ name: 'lazy-approval', enforcesMetadata: ['approval'] })
class ApprovalPlugin {
  @(FlowHooksOf('tools:call-tool').Will('execute'))
  gate() {
    // enforcement itself is not under test here
  }
}

@Tool({ name: 'payout', description: 'Pay a vendor', inputSchema: {}, ...APPROVAL })
class PayoutTool extends ToolContext {
  async execute() {
    return 'paid';
  }
}

@Tool({
  name: 'export_ledger',
  description: 'Export the ledger',
  inputSchema: {},
  rateLimit: { maxRequests: 1, windowMs: 60_000 },
})
class ExportLedgerTool extends ToolContext {
  async execute() {
    return 'exported';
  }
}

@App({ id: 'billing', name: 'Billing', tools: [PayoutTool, ExportLedgerTool] })
class GuardedBillingApp {}

describe('the startup checks of a lazy app loaded by a call', () => {
  const guarded = billingImport({ GuardedBillingApp });

  it('sets up the guard its tools rate limits need', async () => {
    const manifestOfGuarded = await buildManifest(lazyServer(guarded, { plugins: [ApprovalPlugin] }));
    const client = await connect(lazyServer(guarded, { manifest: manifestOfGuarded, plugins: [ApprovalPlugin] }));

    const first = await client.callTool('export_ledger', {});
    const second = await client.callTool('export_ledger', {});
    await client.close();

    expect(textOf(first)).toContain('exported');
    expect(second).toEqual(expect.objectContaining({ isError: true }));
    expect(textOf(second)).toMatch(/rate limit/i);
  });

  it('refuses to load an app with metadata no installed plugin enforces', async () => {
    const manifestOfGuarded = await buildManifest(lazyServer(guarded, { plugins: [ApprovalPlugin] }));
    const client = await connect(lazyServer(guarded, { manifest: manifestOfGuarded }));

    const result = await client.callTool('payout', {});
    await client.close();

    expect(textOf(result)).toContain('LAZY_APP_LOAD_FAILED');
    expect(capturedLogs.filter(({ level }) => level === LogLevel.Error).map(({ message }) => message)).toContainEqual(
      expect.stringContaining(`Tool "payout" declares 'approval'`),
    );
    capturedLogs.length = 0;
  });
});
