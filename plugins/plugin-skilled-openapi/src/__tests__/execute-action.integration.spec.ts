// execute_action and the operation tools server code calls, through a real server and an API that answers with error bodies.
import 'reflect-metadata';

import { Hs256AuditSigner, MemoryAuditStore, type SkillAuditRecord } from '@frontmcp/adapters/skills';
import {
  App,
  FlowHooksOf,
  FrontMcpInstance,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
  z,
  type CallToolResult,
  type DirectAuthContext,
  type DirectMcpServer,
  type FlowCtxOf,
} from '@frontmcp/sdk';

import { MAX_ERROR_BODY_LENGTH } from '../executor/action-outcome';
import { SkilledOpenApiPlugin } from '../index';
import type { SkilledOpenApiPluginOptionsInput } from '../skilled-openapi.types';
import { executeActionDescription } from '../tools/execute-action.schema';
import { loadSkillDescription } from '../tools/load-skill.schema';
import { runWorkflowDescription } from '../tools/run-workflow.schema';
import { searchSkillDescription } from '../tools/search-skill.schema';

const SERVICE_URL = 'https://203.0.113.10/v1';
const BILLING_TOKEN = 'sk_live_billing_0123456789';
const REPORT_TIMEOUT_MS = 50;

const ID_INPUT = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
const ID_IN_PATH = [{ inputKey: 'id', type: 'path', key: 'id', required: true }];

const operation = (operationId: string, httpMethod: string, pathTemplate: string, extra: object = {}) => ({
  operationId,
  serviceId: 'billing',
  httpMethod,
  pathTemplate,
  inputSchema: pathTemplate.includes('{id}') ? ID_INPUT : { type: 'object' },
  outputSchema: { type: 'object' },
  mapper: pathTemplate.includes('{id}') ? ID_IN_PATH : [],
  authBindingRef: 'vault',
  ...extra,
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
      id: 'billing-admin',
      name: 'Billing administration',
      description: 'Look up and void invoices.',
      instructions: '# Billing administration',
      operationIds: ['getInvoice', 'voidInvoice'],
      requiredAuthorities: { roles: { any: ['admin'] } },
    },
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Look up and refund invoices.',
      instructions: '# Invoices',
      operationIds: ['getInvoice', 'listInvoices', 'refundInvoice', 'getBalance', 'getReport', 'exportInvoices'],
    },
  ],
  operations: {
    getInvoice: operation('getInvoice', 'GET', '/invoices/{id}'),
    voidInvoice: operation('voidInvoice', 'POST', '/invoices/{id}/void'),
    listInvoices: operation('listInvoices', 'GET', '/invoices', { outputSchema: { type: 'array' } }),
    refundInvoice: operation('refundInvoice', 'POST', '/invoices/{id}/refunds', {
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, amount: { type: 'number' } },
        required: ['id', 'amount'],
      },
      mapper: [...ID_IN_PATH, { inputKey: 'amount', type: 'body', key: 'amount', required: true }],
    }),
    getBalance: operation('getBalance', 'GET', '/balance', {
      outputSchema: { type: 'object', properties: { balance: { type: 'number' } }, required: ['balance'] },
    }),
    getReport: operation('getReport', 'GET', '/reports', { timeoutMs: REPORT_TIMEOUT_MS }),
    exportInvoices: operation('exportInvoices', 'POST', '/exports'),
  },
};

const INVOICE = { id: 'inv_1', amount: 120 };
const REFUND_TOO_LARGE = {
  error: 'refund_too_large',
  message: 'Refund 500 exceeds the paid amount 120.',
  maxRefund: 120,
};
const LARGE_ERROR = { error: 'export_failed', rows: Array.from({ length: 300 }, (_, row) => `row ${row} failed`) };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function abandonedWhenAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
}

interface SentRequest {
  method: string;
  path: string;
  authorization: string | null;
}

const sent: SentRequest[] = [];

function billingApi(url: string, init?: RequestInit): Response | Promise<Response> {
  const path = new URL(url).pathname;
  sent.push({ method: init?.method ?? 'GET', path, authorization: new Headers(init?.headers).get('authorization') });
  if (path === '/v1/invoices/inv_1') return jsonResponse(200, INVOICE);
  if (path === '/v1/invoices') return jsonResponse(200, [INVOICE]);
  if (path === '/v1/invoices/inv_1/void') return new Response(null, { status: 204 });
  if (path === '/v1/invoices/inv_1/refunds') return jsonResponse(422, REFUND_TOO_LARGE);
  if (path === '/v1/balance') return jsonResponse(200, { balance: 'lots' });
  if (path === '/v1/reports') return abandonedWhenAborted(init?.signal);
  if (path === '/v1/exports') return jsonResponse(500, LARGE_ERROR);
  return jsonResponse(404, { error: 'invoice not found' });
}

const toolCalls: string[] = [];
const ToolHook = FlowHooksOf('tools:call-tool');

@Plugin({ name: 'tool-call-log' })
class ToolCallLogPlugin {
  @ToolHook.Will('execute')
  logToolCall(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    toolCalls.push(flowCtx.state.tool?.metadata.name ?? '');
  }
}

@Tool({
  name: 'call_operation',
  inputSchema: { operationId: z.string(), input: z.record(z.string(), z.unknown()) },
})
class CallOperationTool extends ToolContext {
  async execute({ operationId, input }: { operationId: string; input: Record<string, unknown> }) {
    const answer = await this.callTool(`acme:billing.${operationId}`, input);
    return { isError: answer.isError === true, outcome: answer.structuredContent };
  }
}

@App({ name: 'host', tools: [CallOperationTool] })
class HostApp {}

const ANONYMOUS: DirectAuthContext = { sessionId: 'anonymous', user: { sub: 'anonymous' } };
const VIEWER: DirectAuthContext = { sessionId: 'viewer', user: { sub: 'viewer', roles: ['viewer'] } };
const ADMIN: DirectAuthContext = { sessionId: 'alice', user: { sub: 'alice', roles: ['admin'] } };

const originalFetch = global.fetch;
const servers: DirectMcpServer[] = [];

async function startServer(
  options: Partial<SkilledOpenApiPluginOptionsInput> = {},
  auditStore = new MemoryAuditStore(),
): Promise<DirectMcpServer> {
  const started = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [HostApp],
    plugins: [
      ToolCallLogPlugin,
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
        signer: new Hs256AuditSigner('execute-action-signing-secret', 'execute-action'),
        store: auditStore,
      },
    },
    logging: { level: LogLevel.Off },
  } as never);
  servers.push(started);
  await started.listTools({ authContext: ADMIN });
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

beforeEach(() => {
  sent.length = 0;
  toolCalls.length = 0;
});

function executeAction(
  actionId: string,
  input?: Record<string, unknown>,
  { target = server, caller = ANONYMOUS }: { target?: DirectMcpServer; caller?: DirectAuthContext } = {},
): Promise<CallToolResult> {
  const args = input === undefined ? { actionId } : { actionId, input };
  return target.callTool('execute_action', args, { authContext: caller }) as Promise<CallToolResult>;
}

function textOf(result: CallToolResult): string {
  return result.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

async function callOperation(operationId: string, input: Record<string, unknown>, target = server) {
  const result = await target.callTool('call_operation', { operationId, input }, { authContext: ANONYMOUS });
  return result.structuredContent as { isError: boolean; outcome?: Record<string, unknown> };
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

describe('the tools', () => {
  it('are search_skill, load_skill, execute_action and run_workflow', async () => {
    const { tools } = await server.listTools({ authContext: ANONYMOUS });

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'call_operation',
      'execute_action',
      'load_skill',
      'run_workflow',
      'search_skill',
    ]);
  });

  it('have descriptions within the 1024-character tool-description budget', () => {
    const descriptions = [
      searchSkillDescription,
      loadSkillDescription,
      executeActionDescription,
      runWorkflowDescription,
    ];

    expect(descriptions.map((description) => description.length <= 1024)).toEqual([true, true, true, true]);
  });

  it('point one action to execute_action and a chain of actions to run_workflow', () => {
    for (const description of [searchSkillDescription, loadSkillDescription, runWorkflowDescription]) {
      expect(description).toContain('`execute_action`');
    }
    expect(executeActionDescription).toContain('To chain several actions in one call');
    expect(executeActionDescription).toContain('`run_workflow`');
  });

  it("annotate execute_action as run_workflow's: it may change data in the API", async () => {
    const { tools } = await server.listTools({ authContext: ANONYMOUS });
    const annotationsOf = (name: string) => tools.find((tool) => tool.name === name)?.annotations;

    expect(annotationsOf('execute_action')).toEqual(annotationsOf('run_workflow'));
    expect(annotationsOf('execute_action')).toMatchObject({ destructiveHint: true, openWorldHint: true });
  });
});

describe('execute_action', () => {
  it("answers with the action's data, through its operation tool, whose tools:call-tool hooks run", async () => {
    const result = await executeAction('getInvoice', { id: 'inv_1' });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(INVOICE);
    expect(JSON.parse(textOf(result))).toEqual(INVOICE);
    expect(toolCalls).toEqual(['execute_action', 'acme:billing.getInvoice']);
    expect(sent).toEqual([{ method: 'GET', path: '/v1/invoices/inv_1', authorization: `Bearer ${BILLING_TOKEN}` }]);
  });

  it('answers an array under value, and a bodyless answer with its status', async () => {
    const listed = await executeAction('listInvoices');
    const voided = await executeAction('voidInvoice', { id: 'inv_1' }, { caller: ADMIN });

    expect(listed.structuredContent).toEqual({ value: [INVOICE] });
    expect(voided.isError).toBeFalsy();
    expect(voided.structuredContent).toBeUndefined();
    expect(textOf(voided)).toBe('action "voidInvoice" succeeded with status 204 and no content');
  });

  it('fails an unknown action as run_workflow does, sending nothing', async () => {
    const result = await executeAction('doesNotExist', {});

    const error = 'unknown action "doesNotExist" — run search_skill then load_skill to discover available actions';
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(error);
    expect(result.structuredContent).toEqual({ ok: false, status: 0, error });
    expect(sent).toEqual([]);
  });

  it('fails an action of a skill whose rule hides it from the caller as an unknown action, sending nothing', async () => {
    const denied = await executeAction('voidInvoice', { id: 'inv_1' }, { caller: VIEWER });

    const error = 'unknown action "voidInvoice" — run search_skill then load_skill to discover available actions';
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toBe(error);
    expect(denied.structuredContent).toEqual({ ok: false, status: 0, error });
    expect(sent).toEqual([]);
  });

  it('runs an operation a public and an admin-only skill both list, for a caller either skill admits', async () => {
    const asViewer = await executeAction('getInvoice', { id: 'inv_1' }, { caller: VIEWER });
    const asAdmin = await executeAction('getInvoice', { id: 'inv_1' }, { caller: ADMIN });

    expect(asViewer).toMatchObject({ structuredContent: INVOICE });
    expect(asViewer.isError).toBeFalsy();
    expect(asAdmin).toMatchObject({ structuredContent: INVOICE });
    expect(sent).toHaveLength(2);
  });

  it('fails an input the action schema refuses, sending nothing', async () => {
    const result = await executeAction('getInvoice', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^input validation failed: id: /);
    expect(result.structuredContent).toMatchObject({ ok: false, status: 0 });
    expect(sent).toEqual([]);
  });

  it("fails a 422 answer with the API's error body", async () => {
    const result = await executeAction('refundInvoice', { id: 'inv_1', amount: 500 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`action "refundInvoice" failed with status 422: ${JSON.stringify(REFUND_TOO_LARGE)}`);
    expect(result.structuredContent).toEqual({ ok: false, status: 422, data: REFUND_TOO_LARGE });
  });

  it("names the status alone with outbound.errorBodies 'status-only'", async () => {
    const statusOnly = await startServer({ outbound: { errorBodies: 'status-only' } });

    const result = await executeAction('refundInvoice', { id: 'inv_1', amount: 500 }, { target: statusOnly });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('action "refundInvoice" failed with status 422');
    expect(result.structuredContent).toEqual({ ok: false, status: 422 });
  });

  it("fails a request that outlasts the operation's timeoutMs", async () => {
    const result = await executeAction('getReport');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`timeout after ${REPORT_TIMEOUT_MS}ms`);
    expect(result.structuredContent).toEqual({ ok: false, status: 0, error: `timeout after ${REPORT_TIMEOUT_MS}ms` });
  });

  it("fails an answer that doesn't match the action's output schema", async () => {
    const result = await executeAction('getBalance');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'upstream response failed output schema: balance: Invalid input: expected number, received string',
    );
    expect(result.structuredContent).toMatchObject({ ok: false, status: 200 });
  });

  it('writes the audit records a run_workflow call writes', async () => {
    const auditStore = new MemoryAuditStore();
    const audited = await startServer({}, auditStore);

    await executeAction('getInvoice', { id: 'inv_1' }, { target: audited });
    await executeAction('getInvoice', {}, { target: audited });
    await executeAction('voidInvoice', { id: 'inv_1' }, { target: audited });

    expect(await auditedPhases(auditStore, 5)).toEqual([
      'authority-check-pass:getInvoice',
      'http-call-success:getInvoice',
      'authority-check-pass:getInvoice',
      'http-call-failure:getInvoice',
      'authority-check-fail:voidInvoice',
    ]);
  });

  it('never shows the credential, in a result or an error', async () => {
    const results = [
      await executeAction('getInvoice', { id: 'inv_1' }),
      await executeAction('getInvoice', { id: 'inv_404' }),
      await executeAction('exportInvoices'),
    ];

    expect(sent.map((request) => request.authorization)).toEqual(Array(3).fill(`Bearer ${BILLING_TOKEN}`));
    expect(JSON.stringify(results)).not.toContain(BILLING_TOKEN);
  });
});

describe('execute_action with exposeOperationsAsInternalTools: false', () => {
  let withoutOperationTools: DirectMcpServer;
  let auditStore: MemoryAuditStore;

  beforeAll(async () => {
    auditStore = new MemoryAuditStore();
    withoutOperationTools = await startServer({ exposeOperationsAsInternalTools: false }, auditStore);
  });

  it('runs the action itself, with the same checks, error body and audit records', async () => {
    const succeeded = await executeAction('getInvoice', { id: 'inv_1' }, { target: withoutOperationTools });
    const refused = await executeAction(
      'refundInvoice',
      { id: 'inv_1', amount: 500 },
      { target: withoutOperationTools },
    );

    expect(succeeded.structuredContent).toEqual(INVOICE);
    expect(refused).toMatchObject({
      isError: true,
      structuredContent: { ok: false, status: 422, data: REFUND_TOO_LARGE },
    });
    expect(toolCalls).toEqual(['execute_action', 'execute_action']);
    expect(await auditedPhases(auditStore, 4)).toEqual([
      'authority-check-pass:getInvoice',
      'http-call-success:getInvoice',
      'authority-check-pass:refundInvoice',
      'http-call-failure:refundInvoice',
    ]);
  });

  it('leaves no operation tool for server code to call', async () => {
    await expect(callOperation('getInvoice', { id: 'inv_1' }, withoutOperationTools)).rejects.toThrow(/not found/i);
    expect(sent).toEqual([]);
  });
});

describe('an operation tool server code calls with this.callTool', () => {
  it('answers { ok, status, data, contentType }, with no isError', async () => {
    expect(await callOperation('getInvoice', { id: 'inv_1' })).toEqual({
      isError: false,
      outcome: { ok: true, status: 200, data: INVOICE, contentType: 'application/json' },
    });
  });

  it("checks the answer against the operation's output schema", async () => {
    expect(await callOperation('getBalance', {})).toEqual({
      isError: false,
      outcome: {
        ok: false,
        status: 200,
        contentType: 'application/json',
        error: 'upstream response failed output schema: balance: Invalid input: expected number, received string',
      },
    });
  });

  it("carries the API's error body cut to 2 KB, and the status alone with errorBodies 'status-only'", async () => {
    const statusOnly = await startServer({ outbound: { errorBodies: 'status-only' } });

    const cut = await callOperation('exportInvoices', {});
    const statusAlone = await callOperation('refundInvoice', { id: 'inv_1', amount: 500 }, statusOnly);

    expect(cut.outcome).toEqual({
      ok: false,
      status: 500,
      contentType: 'application/json',
      data: `${JSON.stringify(LARGE_ERROR).slice(0, MAX_ERROR_BODY_LENGTH)}…`,
    });
    expect(statusAlone.outcome).toEqual({ ok: false, status: 422, contentType: 'application/json' });
  });

  it('writes the audit records a run_workflow call writes', async () => {
    const auditStore = new MemoryAuditStore();
    const audited = await startServer({}, auditStore);

    await callOperation('getInvoice', { id: 'inv_1' }, audited);
    await callOperation('voidInvoice', { id: 'inv_1' }, audited);

    expect(await auditedPhases(auditStore, 3)).toEqual([
      'authority-check-pass:getInvoice',
      'http-call-success:getInvoice',
      'authority-check-fail:voidInvoice',
    ]);
  });
});
