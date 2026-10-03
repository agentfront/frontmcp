/**
 * Calling a bundle operation through a real FrontMCP server: what reaches the upstream API.
 *
 * In 1.8.7:
 *   - a JSON request body went out as `text/plain;charset=UTF-8` (no `content-type` was set, so
 *     `fetch` labelled the string body itself);
 *   - every call through a bearer binding with `passthroughCallerToken: true` failed with
 *     `passthrough caller token requested but not supplied`, because the caller's token was never
 *     handed to the executor;
 *   - `exposeOperationsAsInternalTools` registered no tool, so
 *     `this.callTool('acme:billing.getInvoice', …)` answered `Tool … not found`;
 *   - `dev: true` did not turn off the signature requirement, so an unsigned bundle was rejected.
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
import { base64urlEncode } from '@frontmcp/utils';

import { SkilledOpenApiPlugin } from '../index';

const SERVICE_URL = 'https://203.0.113.10/v1';

/** An (unsigned) JWT with these claims; the plugin reads, never verifies, the token it forwards. */
function jwtWith(claims: Record<string, unknown>): string {
  const part = (value: unknown) => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.sig`;
}

/** The caller's token, issued for the billing API (RFC 8707 `resource`). */
const CALLER_TOKEN = jwtWith({ sub: 'caller', resource: SERVICE_URL });

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: SERVICE_URL }],
  authBindings: {
    vault: { kind: 'bearer', vaultRef: 'billing-token' },
    caller: { kind: 'bearer', vaultRef: 'unused', passthroughCallerToken: true },
  },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Create and look up invoices.',
      instructions: '# Invoices',
      operationIds: ['createInvoice', 'getInvoice', 'getProfile', 'getAccountProfile'],
    },
  ],
  operations: {
    createInvoice: {
      operationId: 'createInvoice',
      serviceId: 'billing',
      httpMethod: 'POST',
      pathTemplate: '/invoices',
      inputSchema: {
        type: 'object',
        properties: { customerId: { type: 'string' }, amount: { type: 'number' } },
        required: ['customerId', 'amount'],
      },
      outputSchema: { type: 'object' },
      mapper: [
        { inputKey: 'customerId', type: 'body', key: 'customerId', required: true },
        { inputKey: 'amount', type: 'body', key: 'amount', required: true },
      ],
      authBindingRef: 'vault',
    },
    getInvoice: {
      operationId: 'getInvoice',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/invoices/{id}',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      outputSchema: { type: 'object' },
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
      authBindingRef: 'vault',
    },
    getProfile: {
      operationId: 'getProfile',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/me',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      mapper: [],
      authBindingRef: 'caller',
    },
    getAccountProfile: {
      operationId: 'getAccountProfile',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/{accountId}/me',
      inputSchema: { type: 'object', properties: { accountId: { type: 'string' } }, required: ['accountId'] },
      outputSchema: { type: 'object' },
      mapper: [{ inputKey: 'accountId', type: 'path', key: 'accountId', required: true }],
      authBindingRef: 'caller',
    },
  },
};

interface SentRequest {
  url: string;
  method: string;
  contentType: string | null;
  authorization: string | null;
  body: string | undefined;
}

const sent: SentRequest[] = [];
const originalFetch = global.fetch;

/** The result of the last `this.callTool(...)` the host tool below made. */
let internalCallResult: CallToolResult | undefined;

@Tool({ name: 'lookup_invoice', inputSchema: { id: z.string() } })
class LookupInvoiceTool extends ToolContext {
  async execute({ id }: { id: string }) {
    internalCallResult = await this.callTool('acme:billing.getInvoice', { id });
    return 'done';
  }
}

@App({ name: 'host', tools: [LookupInvoiceTool] })
class HostApp {}

const CALLER: DirectAuthContext = { sessionId: 'caller', token: CALLER_TOKEN, user: { sub: 'caller' } };

let server: DirectMcpServer;

beforeAll(async () => {
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    // `fetch` derives a body's content-type from the body when the request names none: a string
    // body is sent as `text/plain;charset=UTF-8`. Record what the server would see.
    const contentType =
      headers.get('content-type') ?? (typeof init?.body === 'string' ? 'text/plain;charset=UTF-8' : null);
    sent.push({
      url: String(url),
      method: init?.method ?? 'GET',
      contentType,
      authorization: headers.get('authorization'),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(JSON.stringify({ id: 'inv_1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [HostApp],
    plugins: [
      SkilledOpenApiPlugin.init({
        source: { type: 'inline', content: bundle },
        // `dev: true` alone turns the signature requirement off: the bundle above is unsigned.
        dev: true,
        credentials: { 'billing-token': 'vault-secret' },
      }),
    ],
    logging: { level: LogLevel.Off },
  } as never);
  // Load the bundle (a meta-tool call or tools/list does).
  await server.listTools({ authContext: CALLER });
});

afterAll(async () => {
  global.fetch = originalFetch;
  await server?.dispose();
});

beforeEach(() => {
  sent.length = 0;
  internalCallResult = undefined;
});

async function runWorkflowAs(caller: DirectAuthContext, script: string) {
  const result = await server.callTool('run_workflow', { script }, { authContext: caller });
  return result.structuredContent as { success: boolean; error?: string; value?: unknown };
}

const runWorkflow = (script: string) => runWorkflowAs(CALLER, script);

describe('dev: true', () => {
  it('loads an unsigned bundle without requireSignature: false', async () => {
    const found = (await server.callTool('search_skill', { query: 'invoices' }, { authContext: CALLER }))
      .structuredContent as { skills: Array<{ skillId: string }> };

    expect(found.skills.map((s) => s.skillId)).toContain('invoices');
  });
});

describe('a JSON request body', () => {
  it('is sent as application/json', async () => {
    const result = await runWorkflow('return await callTool("createInvoice", { customerId: "cus_1", amount: 42 })');

    expect(result).toMatchObject({ success: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: `${SERVICE_URL}/invoices`,
      method: 'POST',
      contentType: 'application/json',
      authorization: 'Bearer vault-secret',
    });
    expect(JSON.parse(sent[0]?.body ?? '')).toEqual({ customerId: 'cus_1', amount: 42 });
  });

  it('a request without a body carries no content-type', async () => {
    await runWorkflow('return await callTool("getInvoice", { id: "inv_1" })');

    expect(sent[0]).toMatchObject({ method: 'GET', contentType: null, body: undefined });
  });
});

describe('passthroughCallerToken: true', () => {
  it("sends the caller's own token as the bearer credential", async () => {
    const result = await runWorkflow('return await callTool("getProfile", {})');

    expect(result).toMatchObject({ success: true });
    expect(sent).toEqual([
      expect.objectContaining({ url: `${SERVICE_URL}/me`, authorization: `Bearer ${CALLER_TOKEN}` }),
    ]);
  });

  it('sends it from an in-process callTool as well', async () => {
    @Tool({ name: 'whoami', inputSchema: {} })
    class WhoAmITool extends ToolContext {
      async execute() {
        internalCallResult = await this.callTool('acme:billing.getProfile', {});
        return 'done';
      }
    }
    @App({ name: 'whoami-host', tools: [WhoAmITool] })
    class WhoAmIApp {}
    const other = await FrontMcpInstance.createDirect({
      info: { name: 'billing-2', version: '1.0.0' },
      apps: [WhoAmIApp],
      plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, dev: true })],
      logging: { level: LogLevel.Off },
    } as never);
    try {
      await other.listTools({ authContext: CALLER });
      await other.callTool('whoami', {}, { authContext: CALLER });
    } finally {
      await other.dispose();
    }

    expect(internalCallResult?.isError).toBeFalsy();
    expect(sent).toEqual([
      expect.objectContaining({ url: `${SERVICE_URL}/me`, authorization: `Bearer ${CALLER_TOKEN}` }),
    ]);
  });

  it('fails the call, sending nothing, when the caller presented no token', async () => {
    const result = await runWorkflowAs(
      { sessionId: 'anon', user: { sub: 'anon' } },
      'return await callTool("getProfile", {})',
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/caller presented none/);
    expect(sent).toEqual([]);
  });

  it.each([
    [
      'issued for another API',
      jwtWith({ sub: 'caller', aud: 'https://mcp.example.com', resource: 'https://mcp.example.com' }),
    ],
    ['issued for a sibling path', jwtWith({ sub: 'caller', resource: 'https://203.0.113.10/v10' })],
    ['issued for a narrower resource', jwtWith({ sub: 'caller', resource: `${SERVICE_URL}/invoices` })],
    ['naming no API at all', jwtWith({ sub: 'caller' })],
    ['not a JWT', 'opaque-token'],
  ])('refuses to forward a token %s, sending nothing', async (_case, token) => {
    const result = await runWorkflowAs(
      { sessionId: 'other', token, user: { sub: 'caller' } },
      'return await callTool("getProfile", {})',
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/passthrough caller token refused/);
    expect(sent).toEqual([]);
  });

  it('forwards it to an operation path built from a path parameter', async () => {
    const result = await runWorkflow('return await callTool("getAccountProfile", { accountId: "acct_1" })');

    expect(result).toMatchObject({ success: true });
    expect(sent).toEqual([
      expect.objectContaining({ url: `${SERVICE_URL}/acct_1/me`, authorization: `Bearer ${CALLER_TOKEN}` }),
    ]);
  });

  it.each([
    ['resolves above the API', '..', /was not issued for https:\/\/203\.0\.113\.10\/me /],
    ['hides a ".." segment behind an encoded slash', '../..', /has a "\.\." segment once percent-decoded/],
  ])('sends nothing when a path parameter %s', async (_case, accountId, reason) => {
    const result = await runWorkflow(
      `return await callTool("getAccountProfile", { accountId: ${JSON.stringify(accountId)} })`,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/passthrough caller token refused/);
    expect(result.error).toMatch(reason);
    expect(sent).toEqual([]);
  });

  it.each([
    ['its aud claim', jwtWith({ sub: 'caller', aud: [SERVICE_URL, 'https://mcp.example.com'] })],
    ['an origin-wide resource', jwtWith({ sub: 'caller', resource: 'https://203.0.113.10' })],
    ['a resource with a trailing slash', jwtWith({ sub: 'caller', resource: `${SERVICE_URL}/` })],
  ])('forwards a token that names the API in %s', async (_case, token) => {
    const result = await runWorkflowAs(
      { sessionId: 'aud', token, user: { sub: 'caller' } },
      'return await callTool("getProfile", {})',
    );

    expect(result).toMatchObject({ success: true });
    expect(sent).toEqual([expect.objectContaining({ authorization: `Bearer ${token}` })]);
  });
});

describe('exposeOperationsAsInternalTools (default true)', () => {
  it('makes each operation callable in-process as <bundleId>.<operationId>', async () => {
    const result = await server.callTool('lookup_invoice', { id: 'inv_7' }, { authContext: CALLER });

    expect(result.isError).toBeFalsy();
    expect(internalCallResult?.isError).toBeFalsy();
    expect(sent).toEqual([
      expect.objectContaining({ url: `${SERVICE_URL}/invoices/inv_7`, authorization: 'Bearer vault-secret' }),
    ]);
    expect(JSON.stringify(internalCallResult?.structuredContent ?? internalCallResult?.content)).toContain('inv_1');
  });

  it('keeps the operation tools out of tools/list and refuses them to an MCP client', async () => {
    const names = (await server.listTools({ authContext: CALLER })).tools.map((t) => t.name);

    expect(names).not.toContain('acme:billing.getInvoice');
    await expect(server.callTool('acme:billing.getInvoice', { id: 'inv_7' }, { authContext: CALLER })).rejects.toThrow(
      /not found/i,
    );
    expect(sent).toEqual([]);
  });
});
