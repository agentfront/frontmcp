/**
 * An operation several skills list, each with its own skill-level `requiredAuthorities`, through a real server.
 *
 * In 1.11.0 a call resolved such an operation to the first skill in the bundle that lists it, and that skill's
 * rule alone decided: a viewer who `load_skill` showed `getInvoice` through a public skill was denied it when an
 * admin-only skill listing `getInvoice` came first in the bundle, and admitted in the other order.
 */
import 'reflect-metadata';

import {
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  z,
  type CallToolResult,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';

const SERVICE_URL = 'https://203.0.113.10/v1';
const ADMIN = { roles: { any: ['admin'] } };
const ACTION_IDS = ['getInvoice', 'voidInvoice'];

const operation = (operationId: string, httpMethod: string, pathTemplate: string, extra: Record<string, unknown>) => ({
  operationId,
  serviceId: 'billing',
  httpMethod,
  pathTemplate,
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  outputSchema: { type: 'object' },
  mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
  authBindingRef: 'none',
  summary: `${operationId} summary`,
  ...extra,
});

const invoicesSkill = {
  id: 'invoices',
  name: 'Invoices',
  description: 'Look up invoices.',
  instructions: '# Invoices',
  operationIds: ['getInvoice'],
};
const adminSkill = {
  id: 'billing-admin',
  name: 'Billing administration',
  description: 'Look up and void invoices.',
  instructions: '# Billing administration',
  operationIds: ['getInvoice', 'voidInvoice'],
  requiredAuthorities: ADMIN,
};

const bundleWith = (skills: readonly object[], getInvoiceExtra: Record<string, unknown>) => ({
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: SERVICE_URL }],
  authBindings: { none: { kind: 'none' } },
  skills,
  operations: {
    getInvoice: operation('getInvoice', 'GET', '/invoices/{id}', getInvoiceExtra),
    voidInvoice: operation('voidInvoice', 'POST', '/invoices/{id}/void', {}),
  },
});

const VIEWER: DirectAuthContext = { sessionId: 'viewer', user: { sub: 'viewer', roles: ['viewer'] } };
const ADMIN_USER: DirectAuthContext = { sessionId: 'alice', user: { sub: 'alice', roles: ['admin'] } };
const CALLERS = [
  ['a viewer', VIEWER],
  ['an admin', ADMIN_USER],
] as const;
const ORDERS = [
  ['the public skill first', [invoicesSkill, adminSkill]],
  ['the admin skill first', [adminSkill, invoicesSkill]],
] as const;

type OperationToolAnswer = { ok: boolean; error?: string };

/** Calls an internal operation tool in process and returns what it answered. */
@Tool({
  name: 'call_operation',
  inputSchema: { operationId: z.string() },
  outputSchema: { ok: z.boolean(), error: z.string().optional() },
})
class CallOperationTool extends ToolContext {
  async execute({ operationId }: { operationId: string }) {
    const result: CallToolResult = await this.callTool(`acme:billing.${operationId}`, { id: 'INV-1' });
    const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    return JSON.parse(text) as OperationToolAnswer;
  }
}

@App({ name: 'host', tools: [CallOperationTool] })
class HostApp {}

const originalFetch = global.fetch;
const outbound: string[] = [];

beforeAll(() => {
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    outbound.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  outbound.length = 0;
});

async function startServer(
  skills: readonly object[],
  options: { unprotectedOps?: 'allow' | 'deny'; getInvoice?: Record<string, unknown> } = {},
): Promise<DirectMcpServer> {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [HostApp],
    plugins: [
      SkilledOpenApiPlugin.init({
        source: { type: 'inline', content: bundleWith(skills, options.getInvoice ?? {}) },
        requireSignature: false,
        ...(options.unprotectedOps ? { unprotectedOps: options.unprotectedOps } : {}),
      }),
    ],
    logging: { level: LogLevel.Off },
  } as never);
  await server.listTools({ authContext: ADMIN_USER });
  return server;
}

async function runAction(server: DirectMcpServer, caller: DirectAuthContext, actionId: string) {
  const script = `return await callTool("${actionId}", { id: "INV-1" })`;
  const result = await server.callTool('run_workflow', { script }, { authContext: caller });
  return result.structuredContent as { success: boolean; error?: string };
}

async function callOperationTool(server: DirectMcpServer, caller: DirectAuthContext, operationId: string) {
  const result = await server.callTool('call_operation', { operationId }, { authContext: caller });
  return result.structuredContent as OperationToolAnswer;
}

/** Every action `load_skill` shows the caller, over the skills it may load. */
async function actionsShownTo(server: DirectMcpServer, caller: DirectAuthContext): Promise<string[]> {
  const shown = new Set<string>();
  for (const skillId of [invoicesSkill.id, adminSkill.id]) {
    const loaded = await server
      .callTool('load_skill', { skillId }, { authContext: caller })
      .catch((): undefined => undefined);
    const skill = loaded?.structuredContent?.['skill'] as { actions?: Array<{ actionId: string }> } | undefined;
    for (const action of skill?.actions ?? []) shown.add(action.actionId);
  }
  return [...shown].sort();
}

async function actionsRunnableBy(server: DirectMcpServer, caller: DirectAuthContext): Promise<string[]> {
  const runnable: string[] = [];
  for (const actionId of ACTION_IDS) {
    if ((await runAction(server, caller, actionId)).success) runnable.push(actionId);
  }
  return runnable;
}

describe.each(ORDERS)('an operation a public and an admin-only skill both list, %s', (_order, skills) => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await startServer(skills);
  });

  afterAll(async () => {
    await server?.dispose();
  });

  it('runs for a viewer, who sees it through the public skill', async () => {
    expect(await actionsShownTo(server, VIEWER)).toContain('getInvoice');

    expect(await runAction(server, VIEWER, 'getInvoice')).toMatchObject({ success: true });
    expect(outbound).toEqual([`${SERVICE_URL}/invoices/INV-1`]);
  });

  it('runs for an admin', async () => {
    expect(await runAction(server, ADMIN_USER, 'getInvoice')).toMatchObject({ success: true });
    expect(outbound).toEqual([`${SERVICE_URL}/invoices/INV-1`]);
  });

  it('stays denied to a viewer when only the admin skill lists it', async () => {
    expect(await actionsShownTo(server, VIEWER)).not.toContain('voidInvoice');

    const result = await runAction(server, VIEWER, 'voidInvoice');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^authority denied: /);
    expect(outbound).toEqual([]);
  });

  it.each(CALLERS)('runs for %s exactly the actions load_skill shows it', async (_caller, caller) => {
    expect(await actionsRunnableBy(server, caller)).toEqual(await actionsShownTo(server, caller));
  });

  it('admits the same callers to the internal operation tools', async () => {
    expect(await callOperationTool(server, VIEWER, 'getInvoice')).toMatchObject({ ok: true });
    expect(await callOperationTool(server, ADMIN_USER, 'getInvoice')).toMatchObject({ ok: true });
    expect(await callOperationTool(server, ADMIN_USER, 'voidInvoice')).toMatchObject({ ok: true });

    const denied = await callOperationTool(server, VIEWER, 'voidInvoice');
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/^authority denied: /);
  });
});

describe.each(ORDERS)('with unprotectedOps: "deny", %s', (_order, skills) => {
  it('a shared operation with no rule of its own runs only through the admin skill', async () => {
    const server = await startServer(skills, { unprotectedOps: 'deny' });
    try {
      expect(await actionsShownTo(server, VIEWER)).toEqual([]);
      expect(await actionsRunnableBy(server, VIEWER)).toEqual([]);
      expect(await actionsShownTo(server, ADMIN_USER)).toEqual(ACTION_IDS);
      expect(await actionsRunnableBy(server, ADMIN_USER)).toEqual(ACTION_IDS);
    } finally {
      await server.dispose();
    }
  });

  it('a shared operation marked public runs for a viewer too', async () => {
    const server = await startServer(skills, { unprotectedOps: 'deny', getInvoice: { public: true } });
    try {
      expect(await actionsShownTo(server, VIEWER)).toEqual(['getInvoice']);
      expect(await actionsRunnableBy(server, VIEWER)).toEqual(['getInvoice']);
    } finally {
      await server.dispose();
    }
  });
});
