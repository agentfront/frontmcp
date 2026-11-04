// Actions the confirm option names ask the user, through a real server and an in-process client, before their request.
import 'reflect-metadata';

import { Hs256AuditSigner, MemoryAuditStore, type SkillAuditRecord } from '@frontmcp/adapters/skills';
import {
  App,
  connect,
  LogLevel,
  Tool,
  ToolContext,
  z,
  type CallToolResult,
  type DirectClient,
  type FrontMcpConfigInput,
} from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';
import type { SkilledOpenApiPluginOptionsInput } from '../skilled-openapi.types';

const SERVICE_URL = 'https://203.0.113.10/v1';
const ID_INPUT = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
const ID_IN_PATH = [{ inputKey: 'id', type: 'path', key: 'id', required: true }];
const TWELVE_TEST_INVOICES = Array.from({ length: 12 }, (_, index) => `inv_test_${index + 1}`);

const operation = (operationId: string, httpMethod: string, summary: string, extra: object = {}) => ({
  operationId,
  serviceId: 'billing',
  httpMethod,
  pathTemplate: '/invoices/{id}',
  summary,
  inputSchema: ID_INPUT,
  outputSchema: {},
  mapper: ID_IN_PATH,
  authBindingRef: 'none',
  ...extra,
});

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: SERVICE_URL }],
  authBindings: { none: { kind: 'none' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Look up, void and refund invoices.',
      instructions: '# Invoices',
      tags: ['billing'],
      operationIds: ['getInvoice', 'voidInvoice', 'refundInvoice'],
    },
    {
      id: 'cleanup',
      name: 'Cleanup',
      description: 'Remove draft invoices.',
      instructions: '# Cleanup',
      tags: ['destructive'],
      operationIds: ['purgeDraft'],
    },
  ],
  operations: {
    getInvoice: operation('getInvoice', 'GET', 'Fetch an invoice'),
    voidInvoice: operation('voidInvoice', 'DELETE', 'Void an invoice'),
    refundInvoice: operation('refundInvoice', 'POST', 'Refund an invoice', {
      pathTemplate: '/invoices/{id}/refunds',
      tags: ['invoices', 'money-out'],
    }),
    purgeDraft: operation('purgeDraft', 'POST', 'Purge a draft invoice', { pathTemplate: '/drafts/{id}/purge' }),
  },
};

const CONFIRM_DELETES_AND_TAGGED = { methods: ['DELETE' as const], tags: ['money-out', 'destructive'] };

const sent: string[] = [];

function billingApi(url: string, init?: RequestInit): Response {
  sent.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
  if (init?.method === 'DELETE') return new Response(null, { status: 204 });
  return new Response(JSON.stringify({ id: 'inv_1', status: 'open' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

@Tool({ name: 'void_through_operation_tool', inputSchema: { id: z.string() } })
class VoidThroughOperationTool extends ToolContext {
  async execute({ id }: { id: string }) {
    const answer = await this.callTool('acme:billing.voidInvoice', { id });
    return { outcome: answer.structuredContent };
  }
}

@App({ name: 'host', tools: [VoidThroughOperationTool] })
class HostApp {}

type Answer = 'accept' | 'decline';

interface ServerSetup {
  plugin?: Partial<SkilledOpenApiPluginOptionsInput>;
  /** How the client answers each question; leave it out for a client without elicitation. */
  answer?: Answer;
  elicitationEnabled?: boolean;
  auditStore?: MemoryAuditStore;
}

const clients: DirectClient[] = [];

async function connectClient(setup: ServerSetup): Promise<{ client: DirectClient; asked: string[] }> {
  const asked: string[] = [];
  const config: FrontMcpConfigInput = {
    info: { name: 'billing', version: '1.0.0' },
    apps: [HostApp],
    plugins: [
      SkilledOpenApiPlugin.init({
        source: { type: 'inline', content: bundle },
        dev: true,
        confirm: CONFIRM_DELETES_AND_TAGGED,
        ...setup.plugin,
      }),
    ],
    ...(setup.elicitationEnabled === false ? {} : { elicitation: { enabled: true } }),
    ...(setup.auditStore
      ? {
          skillsConfig: {
            enabled: true,
            audit: {
              enabled: true,
              signer: new Hs256AuditSigner('confirm-actions-signing-secret', 'confirm-actions'),
              store: setup.auditStore,
            },
          },
        }
      : {}),
    logging: { level: LogLevel.Off },
  } as FrontMcpConfigInput;
  const { answer } = setup;
  const client = await connect(
    config,
    answer
      ? {
          onElicitation: async (request) => {
            asked.push(request.message);
            return answer === 'accept' ? { action: 'accept', content: { confirmed: true } } : { action: 'decline' };
          },
        }
      : {},
  );
  clients.push(client);
  return { client, asked };
}

async function call(client: DirectClient, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await client.callTool(name, args)) as CallToolResult;
}

function textOf(result: CallToolResult): string {
  return result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

async function auditedPhases(auditStore: MemoryAuditStore, count: number): Promise<string[]> {
  const deadline = Date.now() + 5_000;
  let records: SkillAuditRecord[] = [];
  while (Date.now() < deadline) {
    records = await auditStore.read();
    if (records.length >= count) {
      return records.map((record) => [record.phase, record.actionId, record.errorMessage].filter(Boolean).join(':'));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected ${count} audit records, got ${records.length}`);
}

const originalFetch = global.fetch;

beforeAll(() => {
  global.fetch = (async (input: string | URL, init?: RequestInit) => billingApi(String(input), init)) as typeof fetch;
});

afterAll(async () => {
  global.fetch = originalFetch;
  await Promise.all(clients.map((client) => client.close()));
});

beforeEach(() => {
  sent.length = 0;
});

describe('a server whose confirm option names DELETE actions and tagged ones', () => {
  it('asks before execute_action sends a DELETE, naming the action and its input, and sends it once confirmed', async () => {
    const { client, asked } = await connectClient({ answer: 'accept' });

    const result = await call(client, 'execute_action', { actionId: 'voidInvoice', input: { id: 'inv_1' } });

    expect(result.isError).not.toBe(true);
    expect(asked).toEqual(['Run voidInvoice: Void an invoice (DELETE /invoices/{id}) with {"id":"inv_1"}?']);
    expect(sent).toEqual(['DELETE /v1/invoices/inv_1']);
  });

  it('sends nothing, and fails the call with the decline, when the user declines', async () => {
    const { client } = await connectClient({ answer: 'decline' });

    const result = await call(client, 'execute_action', { actionId: 'voidInvoice', input: { id: 'inv_1' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('the user declined: voidInvoice');
    expect(result.structuredContent).toEqual({ ok: false, status: 0, error: 'the user declined: voidInvoice' });
    expect(sent).toEqual([]);
  });

  it("asks for an action a tag of its operation names and one a tag of its skill names, and doesn't ask for a read", async () => {
    const { client, asked } = await connectClient({ answer: 'accept' });

    await call(client, 'execute_action', { actionId: 'refundInvoice', input: { id: 'inv_1' } });
    await call(client, 'execute_action', { actionId: 'purgeDraft', input: { id: 'draft_1' } });
    await call(client, 'execute_action', { actionId: 'getInvoice', input: { id: 'inv_1' } });

    expect(asked).toEqual([expect.stringMatching(/^Run refundInvoice: /), expect.stringMatching(/^Run purgeDraft: /)]);
    expect(sent).toEqual([
      'POST /v1/invoices/inv_1/refunds',
      'POST /v1/drafts/draft_1/purge',
      'GET /v1/invoices/inv_1',
    ]);
  });

  it('asks once, before it starts, for a workflow that voids twelve invoices, then sends all twelve', async () => {
    const { client, asked } = await connectClient({ answer: 'accept' });
    const script = [
      `const ids = ${JSON.stringify(TWELVE_TEST_INVOICES)};`,
      "for (const id of ids) await callTool('voidInvoice', { id });",
      'return ids.length;',
    ].join('\n');

    const result = await call(client, 'run_workflow', { script });

    expect(result.structuredContent).toMatchObject({ success: true, value: 12 });
    expect(asked).toEqual([
      [
        'This workflow can run these actions, as many times as its script calls them:',
        '- voidInvoice: Void an invoice (DELETE /invoices/{id})',
        'Run it?',
      ].join('\n'),
    ]);
    expect(sent).toEqual(TWELVE_TEST_INVOICES.map((id) => `DELETE /v1/invoices/${id}`));
  });

  it('runs none of a workflow the user declines, its reads included', async () => {
    const { client } = await connectClient({ answer: 'decline' });
    const script = [
      "const invoice = await callTool('getInvoice', { id: 'inv_1' });",
      "await callTool('voidInvoice', { id: invoice.id });",
      'return invoice.id;',
    ].join('\n');

    const result = await call(client, 'run_workflow', { script });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ success: false, error: 'the user declined: voidInvoice' });
    expect(sent).toEqual([]);
  });

  it('refuses a workflow call of an action it reaches by a computed id, which the user was not asked about', async () => {
    const { client, asked } = await connectClient({ answer: 'accept' });

    const result = await call(client, 'run_workflow', {
      script: "const verb = 'void'; return await callTool(verb + 'Invoice', { id: 'inv_1' });",
    });

    expect(result.structuredContent).toMatchObject({
      success: false,
      error: expect.stringContaining(`write the actionId as a string, as in callTool('voidInvoice', …)`),
    });
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("asks when the server's own code calls the operation tool", async () => {
    const { client, asked } = await connectClient({ answer: 'decline' });

    const result = await call(client, 'void_through_operation_tool', { id: 'inv_1' });

    expect(asked).toEqual([expect.stringMatching(/^Run voidInvoice: /)]);
    expect(result.structuredContent).toEqual({
      outcome: { ok: false, status: 0, error: 'the user declined: voidInvoice' },
    });
    expect(sent).toEqual([]);
  });

  it('asks in execute_action without operation tools too', async () => {
    const { client, asked } = await connectClient({
      answer: 'accept',
      plugin: { exposeOperationsAsInternalTools: false },
    });

    await call(client, 'execute_action', { actionId: 'voidInvoice', input: { id: 'inv_1' } });

    expect(asked).toEqual([expect.stringMatching(/^Run voidInvoice: /)]);
    expect(sent).toEqual(['DELETE /v1/invoices/inv_1']);
  });

  it('audits a declined call as a failed call, after its authority check', async () => {
    const auditStore = new MemoryAuditStore();
    const { client } = await connectClient({ answer: 'decline', auditStore });

    await call(client, 'execute_action', { actionId: 'voidInvoice', input: { id: 'inv_1' } });

    expect(await auditedPhases(auditStore, 2)).toEqual([
      'authority-check-pass:voidInvoice',
      'http-call-failure:voidInvoice:the user declined: voidInvoice',
    ]);
  });
});

describe('a client that cannot show the question', () => {
  it('is refused an action that needs confirmation, with nothing sent', async () => {
    const { client } = await connectClient({});

    const action = await call(client, 'execute_action', { actionId: 'voidInvoice', input: { id: 'inv_1' } });
    const workflow = await call(client, 'run_workflow', {
      script: "return await callTool('voidInvoice', { id: 'inv_1' });",
    });

    expect(action.isError).toBe(true);
    expect(textOf(action)).toBe(
      "the user's confirmation is needed for voidInvoice, and this client can't ask for it: it doesn't support elicitation; nothing was sent",
    );
    expect(workflow.structuredContent).toMatchObject({
      success: false,
      error: expect.stringContaining("this client can't ask for it"),
    });
    expect(sent).toEqual([]);
  });

  it("runs the action unasked with whenUnsupported: 'allow'", async () => {
    const { client } = await connectClient({
      plugin: { confirm: { ...CONFIRM_DELETES_AND_TAGGED, whenUnsupported: 'allow' } },
    });

    const result = await call(client, 'execute_action', { actionId: 'voidInvoice', input: { id: 'inv_1' } });

    expect(result.isError).not.toBe(true);
    expect(sent).toEqual(['DELETE /v1/invoices/inv_1']);
  });

  it('is refused on a server with elicitation disabled, which says so', async () => {
    const { client, asked } = await connectClient({ answer: 'accept', elicitationEnabled: false });

    const result = await call(client, 'execute_action', { actionId: 'voidInvoice', input: { id: 'inv_1' } });

    expect(textOf(result)).toContain("this server can't ask for it: elicitation is disabled");
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('a server with no confirm option', () => {
  it('runs a DELETE action, and a workflow of them, without asking', async () => {
    const { client, asked } = await connectClient({ answer: 'decline', plugin: { confirm: undefined } });

    await call(client, 'execute_action', { actionId: 'voidInvoice', input: { id: 'inv_1' } });
    await call(client, 'run_workflow', { script: "return await callTool('voidInvoice', { id: 'inv_2' });" });

    expect(asked).toEqual([]);
    expect(sent).toEqual(['DELETE /v1/invoices/inv_1', 'DELETE /v1/invoices/inv_2']);
  });
});
