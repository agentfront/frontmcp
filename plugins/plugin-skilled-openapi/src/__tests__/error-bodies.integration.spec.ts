/**
 * What a script, and so the model, learns from a failed action call: through a real server, the real
 * `@enclave-vm` interpreter and an upstream API that answers with error bodies.
 */
import 'reflect-metadata';

import { Hs256AuditSigner, MemoryAuditStore, type SkillAuditRecord } from '@frontmcp/adapters/skills';
import {
  FrontMcpInstance,
  LogLevel,
  type CallToolResult,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';

import { MAX_ERROR_BODY_LENGTH } from '../executor/action-outcome';
import { SkilledOpenApiPlugin } from '../index';
import type { SkilledOpenApiPluginOptionsInput } from '../skilled-openapi.types';

const SERVICE_URL = 'https://203.0.113.10/v1';
const BILLING_TOKEN = 'sk_live_billing_0123456789';

const operation = (operationId: string, httpMethod: string, pathTemplate: string, properties = {}) => ({
  operationId,
  serviceId: 'billing',
  httpMethod,
  pathTemplate,
  inputSchema: { type: 'object', properties, required: Object.keys(properties) },
  outputSchema: { type: 'object' },
  mapper: Object.keys(properties).map((key) => ({
    inputKey: key,
    type: key === 'id' ? 'path' : 'body',
    key,
    required: true,
  })),
  authBindingRef: 'vault',
});

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: SERVICE_URL }],
  authBindings: { vault: { kind: 'bearer', vaultRef: 'billing-token' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Look up and refund invoices.',
      instructions: '# Invoices',
      operationIds: ['getInvoice', 'refundInvoice', 'getStatus', 'exportInvoices', 'echoRequest'],
    },
    {
      id: 'admin',
      name: 'Admin',
      description: 'Billing administration.',
      instructions: '# Admin',
      operationIds: ['purgeInvoices'],
      requiredAuthorities: { roles: { any: ['admin'] } },
    },
  ],
  operations: {
    getInvoice: operation('getInvoice', 'GET', '/invoices/{id}', { id: { type: 'string' } }),
    refundInvoice: operation('refundInvoice', 'POST', '/invoices/{id}/refunds', {
      id: { type: 'string' },
      amount: { type: 'number' },
    }),
    getStatus: operation('getStatus', 'GET', '/status'),
    exportInvoices: operation('exportInvoices', 'POST', '/exports'),
    echoRequest: operation('echoRequest', 'GET', '/echo'),
    purgeInvoices: operation('purgeInvoices', 'DELETE', '/invoices'),
  },
};

const REFUND_TOO_LARGE = {
  error: 'refund_too_large',
  message: 'Refund 500 exceeds the paid amount 120.',
  maxRefund: 120,
};
const LARGE_ERROR = { error: 'export_failed', rows: Array.from({ length: 300 }, (_, row) => `row ${row} failed`) };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The billing API: an invoice `inv_1` of 120, and an error answer for everything else. */
function billingApi(url: string, init?: RequestInit): Response {
  const path = new URL(url).pathname;
  if (path === '/v1/invoices/inv_1') return jsonResponse(200, { id: 'inv_1', amount: 120 });
  if (path === '/v1/invoices/inv_1/refunds') return jsonResponse(422, REFUND_TOO_LARGE);
  if (path === '/v1/status') {
    return new Response('Down for maintenance until 10:00 UTC.', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }
  if (path === '/v1/exports') return jsonResponse(500, LARGE_ERROR);
  if (path === '/v1/echo') {
    return jsonResponse(400, { error: 'bad request', authorization: new Headers(init?.headers).get('authorization') });
  }
  return jsonResponse(404, { error: 'invoice not found' });
}

const CALLER: DirectAuthContext = { sessionId: 'caller', token: 'caller-token', user: { sub: 'caller' } };
const originalFetch = global.fetch;
const servers: DirectMcpServer[] = [];

async function startServer(
  options: Partial<SkilledOpenApiPluginOptionsInput> = {},
  auditStore = new MemoryAuditStore(),
): Promise<DirectMcpServer> {
  const started = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [],
    plugins: [
      SkilledOpenApiPlugin.init({
        source: { type: 'inline', content: bundle },
        dev: true,
        credentials: { 'billing-token': BILLING_TOKEN },
        ...options,
      }),
    ],
    skillsConfig: {
      enabled: true,
      audit: {
        enabled: true,
        signer: new Hs256AuditSigner('error-bodies-signing-secret', 'error-bodies'),
        store: auditStore,
      },
    },
    logging: { level: LogLevel.Off },
  } as never);
  servers.push(started);
  return started;
}

let server: DirectMcpServer;

beforeAll(async () => {
  global.fetch = (async (input: string | URL, init?: RequestInit) => billingApi(String(input), init)) as typeof fetch;
  server = await startServer();
});

afterAll(async () => {
  global.fetch = originalFetch;
  await Promise.all(servers.map((started) => started.dispose()));
});

function runWorkflowOn(target: DirectMcpServer, script: string): Promise<CallToolResult> {
  return target.callTool('run_workflow', { script }, { authContext: CALLER }) as Promise<CallToolResult>;
}

async function workflowOutput(script: string, target = server) {
  const result = await runWorkflowOn(target, script);
  return result.structuredContent as { success: boolean; value?: unknown; error?: string };
}

async function auditedPhases(auditStore: MemoryAuditStore, count: number): Promise<string[]> {
  const deadline = Date.now() + 5_000;
  let records: SkillAuditRecord[] = [];
  while (Date.now() < deadline) {
    records = await auditStore.read();
    if (records.length >= count) return records.map((record) => `${record.phase}:${record.actionId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected ${count} audit records, got ${records.length}`);
}

describe("a failed action's error carries the API's error body", () => {
  it('compacts a JSON body', async () => {
    const output = await workflowOutput("return await callTool('refundInvoice', { id: 'inv_1', amount: 500 });");

    expect(output).toMatchObject({
      success: false,
      error: `action "refundInvoice" failed with status 422: ${JSON.stringify(REFUND_TOO_LARGE)}`,
    });
  });

  it('keeps a text body as it is', async () => {
    const output = await workflowOutput("return await callTool('getStatus', {});");

    expect(output.error).toBe('action "getStatus" failed with status 503: Down for maintenance until 10:00 UTC.');
  });

  it('cuts a body over the cap and marks the cut', async () => {
    const output = await workflowOutput("return await callTool('exportInvoices', {});");

    const prefix = 'action "exportInvoices" failed with status 500: ';
    expect(output.error).toBe(`${prefix}${JSON.stringify(LARGE_ERROR).slice(0, MAX_ERROR_BODY_LENGTH)}…`);
  });

  it('redacts the credential an API echoes back', async () => {
    const output = await workflowOutput("return await callTool('echoRequest', {});");

    expect(output.error).toBe(
      'action "echoRequest" failed with status 400: {"error":"bad request","authorization":"[REDACTED]"}',
    );
    expect(JSON.stringify(output)).not.toContain(BILLING_TOKEN);
  });

  it("names the status alone with outbound.errorBodies 'status-only'", async () => {
    const statusOnly = await startServer({ outbound: { errorBodies: 'status-only' } });

    const thrown = await workflowOutput(
      "return await callTool('refundInvoice', { id: 'inv_1', amount: 500 });",
      statusOnly,
    );
    const returned = await workflowOutput(
      "return await callTool('refundInvoice', { id: 'inv_1', amount: 500 }, { throwOnError: false });",
      statusOnly,
    );

    expect(thrown.error).toBe('action "refundInvoice" failed with status 422');
    expect(returned.value).toEqual({ ok: false, status: 422 });
  });
});

describe('callTool(actionId, input, { throwOnError: false })', () => {
  it('returns ok, the status and the data of a success', async () => {
    const output = await workflowOutput(
      "return await callTool('getInvoice', { id: 'inv_1' }, { throwOnError: false });",
    );

    expect(output).toMatchObject({
      success: true,
      value: { ok: true, status: 200, data: { id: 'inv_1', amount: 120 } },
    });
  });

  it("returns an HTTP failure's status and the API's error body, so the script can branch", async () => {
    const output = await workflowOutput(
      [
        "const refund = await callTool('refundInvoice', { id: 'inv_1', amount: 500 }, { throwOnError: false });",
        'if (refund.ok) return refund.data;',
        "const retry = await callTool('refundInvoice', { id: 'inv_1', amount: refund.data.maxRefund }, { throwOnError: false });",
        'return { first: refund, retried: retry.status };',
      ].join('\n'),
    );

    expect(output).toMatchObject({
      success: true,
      value: { first: { ok: false, status: 422, data: REFUND_TOO_LARGE }, retried: 422 },
    });
  });

  it('returns status 0 and the reason of a failure with no answer', async () => {
    const output = await workflowOutput(
      [
        "const invalid = await callTool('getInvoice', {}, { throwOnError: false });",
        "const denied = await callTool('purgeInvoices', {}, { throwOnError: false });",
        'return { invalid: invalid, denied: denied };',
      ].join('\n'),
    );

    expect(output.value).toEqual({
      invalid: { ok: false, status: 0, error: expect.stringMatching(/^input validation failed: id/) },
      denied: { ok: false, status: 0, error: "authority denied: roles.any: user has none of 'admin'" },
    });
  });

  it('still audits an HTTP failure as a failure', async () => {
    const auditStore = new MemoryAuditStore();
    const audited = await startServer({}, auditStore);

    await workflowOutput("return await callTool('getInvoice', { id: 'inv_404' }, { throwOnError: false });", audited);

    expect(await auditedPhases(auditStore, 2)).toEqual([
      'authority-check-pass:getInvoice',
      'http-call-failure:getInvoice',
    ]);
  });
});

describe('the run_workflow result', () => {
  it('is an error result, with the same structured content, when the workflow fails', async () => {
    const result = await runWorkflowOn(server, "return await callTool('getInvoice', { id: 'inv_404' });");

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      error: 'action "getInvoice" failed with status 404: {"error":"invoice not found"}',
      stats: { toolCalls: 1 },
    });
  });

  it('is not an error result when the workflow succeeds', async () => {
    const result = await runWorkflowOn(server, "return await callTool('getInvoice', { id: 'inv_1' });");

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ success: true, value: { id: 'inv_1', amount: 120 } });
  });
});
