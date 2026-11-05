/**
 * Each caller's own credential, through a real FrontMCP server: a binding the `authProviders` option maps sends the
 * credential the caller connected, read from the auth providers vault per request, and a custom resolver is told
 * which caller a request is for.
 */
import 'reflect-metadata';

import {
  AUTH_PROVIDERS_ACCESSOR,
  AuthProvidersAccessorImpl,
  AuthProvidersRegistry,
  AuthProvidersVault,
  CredentialCache,
  InMemoryAuthorizationVault,
  LazyCredentialLoader,
} from '@frontmcp/auth';
import {
  App,
  FRONTMCP_CONTEXT,
  FrontMcpInstance,
  LogLevel,
  ProviderScope,
  Tool,
  ToolContext,
  ToolCredentialsRequiredError,
  type CallToolResult,
  type DirectAuthContext,
  type DirectMcpServer,
  type FrontMcpContext,
} from '@frontmcp/sdk';

import { type CredentialResolveOptions } from '../executor/credential-resolver';
import { SkilledOpenApiCredentialResolver, SkilledOpenApiPlugin } from '../index';

const SERVICE_URL = 'https://203.0.113.10/v1';

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: SERVICE_URL }],
  authBindings: {
    account: { kind: 'bearer', vaultRef: 'billing-token' },
    reports: { kind: 'bearer', vaultRef: 'reports-token' },
  },
  skills: [
    {
      id: 'account',
      name: 'Account',
      description: 'Read the account.',
      instructions: '# Account',
      operationIds: ['getBalance', 'getUsage'],
    },
  ],
  operations: {
    getBalance: {
      operationId: 'getBalance',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/balance',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      mapper: [],
      authBindingRef: 'account',
    },
    getUsage: {
      operationId: 'getUsage',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/usage',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      mapper: [],
      authBindingRef: 'reports',
    },
  },
};

/** The bearer token each account answers to, as the billing API would check it. */
const ACCOUNT_OF_TOKEN: Record<string, string> = {
  'Bearer alice-billing-token': 'alice',
  'Bearer bob-billing-token': 'bob',
  'Bearer reports-token': 'reports',
  'Bearer acme-reports-token': 'acme',
  'Bearer globex-reports-token': 'globex',
};

/** The billing token each user connected; carol connected none. */
const CONNECTED_BILLING_TOKENS: Record<string, string> = { alice: 'alice-billing-token', bob: 'bob-billing-token' };

const ALICE: DirectAuthContext = { sessionId: 'alice-session', user: { sub: 'alice' } };
const BOB: DirectAuthContext = { sessionId: 'bob-session', user: { sub: 'bob' } };
const CAROL: DirectAuthContext = { sessionId: 'carol-session', user: { sub: 'carol' } };

const requests: Array<{ url: string; authorization: string | null }> = [];
const originalFetch = global.fetch;

function respondAsBillingApi(url: string | URL | Request, init?: RequestInit): Response {
  const authorization = new Headers(init?.headers).get('authorization');
  requests.push({ url: String(url), authorization });
  const account = authorization ? ACCOUNT_OF_TOKEN[authorization] : undefined;
  if (!account) return Response.json({ error: 'invalid bearer token' }, { status: 401 });
  return Response.json({ account });
}

/** The auth providers vault, built per request for the caller as the SDK builds `this.authProviders`. */
function authProvidersVault() {
  const baseVault = new InMemoryAuthorizationVault();
  const vault = new AuthProvidersVault(baseVault);
  const registry = new AuthProvidersRegistry({
    providers: [
      {
        name: 'billing',
        scope: 'user',
        loading: 'lazy',
        factory: async ({ userSub }) => {
          const token = userSub ? CONNECTED_BILLING_TOKENS[userSub] : undefined;
          return token ? { type: 'bearer', token } : null;
        },
      },
    ],
  });
  return {
    provide: AUTH_PROVIDERS_ACCESSOR,
    name: 'AuthProvidersAccessor',
    scope: ProviderScope.CONTEXT,
    inject: () => [FRONTMCP_CONTEXT] as const,
    useFactory: (context: FrontMcpContext) =>
      new AuthProvidersAccessorImpl(registry, vault, new CredentialCache(), new LazyCredentialLoader(), {
        sessionId: context.authInfo?.sessionId ?? 'anonymous',
        userSub: context.authInfo?.user?.sub,
        vault: baseVault,
      }),
  };
}

let internalCallResult: CallToolResult | undefined;

@Tool({ name: 'show_balance', inputSchema: {} })
class ShowBalanceTool extends ToolContext {
  async execute() {
    internalCallResult = await this.callTool('acme:billing.getBalance', {});
    return 'done';
  }
}

@App({ name: 'host', tools: [ShowBalanceTool] })
class HostApp {}

let server: DirectMcpServer;

beforeAll(async () => {
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) =>
    respondAsBillingApi(url, init),
  ) as unknown as typeof fetch;

  server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [HostApp],
    plugins: [
      SkilledOpenApiPlugin.init({
        source: { type: 'inline', content: bundle },
        dev: true,
        authProviders: { 'billing-token': 'billing' },
        credentials: { 'reports-token': 'reports-token' },
      }),
    ],
    providers: [authProvidersVault()],
    logging: { level: LogLevel.Off },
  } as never);
  await server.listTools({ authContext: ALICE });
});

afterAll(async () => {
  global.fetch = originalFetch;
  await server?.dispose();
});

beforeEach(() => {
  requests.length = 0;
  internalCallResult = undefined;
});

async function runWorkflowAs(caller: DirectAuthContext, script: string, target: DirectMcpServer = server) {
  const result = await target.callTool('run_workflow', { script }, { authContext: caller });
  return result.structuredContent as { success: boolean; error?: string; value?: unknown };
}

describe('a binding the authProviders option maps', () => {
  it("sends each caller's own connected credential, for callers running at the same time", async () => {
    const script =
      'const first = await callTool("getBalance", {}); const second = await callTool("getBalance", {}); return [first.account, second.account];';

    const [alice, bob, aliceAgain] = await Promise.all([
      runWorkflowAs(ALICE, script),
      runWorkflowAs(BOB, script),
      runWorkflowAs(ALICE, script),
    ]);

    expect(alice).toMatchObject({ success: true, value: ['alice', 'alice'] });
    expect(bob).toMatchObject({ success: true, value: ['bob', 'bob'] });
    expect(aliceAgain).toMatchObject({ success: true, value: ['alice', 'alice'] });
    expect(requests.map((request) => request.authorization).sort()).toEqual([
      'Bearer alice-billing-token',
      'Bearer alice-billing-token',
      'Bearer alice-billing-token',
      'Bearer alice-billing-token',
      'Bearer bob-billing-token',
      'Bearer bob-billing-token',
    ]);
  });

  it('asks a caller who has not connected the service to connect it, sending nothing', async () => {
    await runWorkflowAs(ALICE, 'return await callTool("getBalance", {})');
    requests.length = 0;

    const call = runWorkflowAs(CAROL, 'return await callTool("getBalance", {})');

    await expect(call).rejects.toBeInstanceOf(ToolCredentialsRequiredError);
    await expect(call).rejects.toMatchObject({ toolId: 'run_workflow', providers: ['billing'] });
    expect(requests).toEqual([]);
  });

  it("ends the run with throwOnError: false too, with no other caller's token sent", async () => {
    const call = runWorkflowAs(
      CAROL,
      'const balance = await callTool("getBalance", {}, { throwOnError: false }); return balance.ok ? "sent" : "skipped";',
    );

    await expect(call).rejects.toBeInstanceOf(ToolCredentialsRequiredError);
    expect(requests).toEqual([]);
  });

  it("sends the caller's credential from an in-process callTool, and asks one without it to connect", async () => {
    await server.callTool('show_balance', {}, { authContext: BOB });

    expect(internalCallResult?.structuredContent).toMatchObject({ ok: true, data: { account: 'bob' } });

    await expect(server.callTool('show_balance', {}, { authContext: CAROL })).rejects.toMatchObject({
      toolId: 'acme:billing.getBalance',
      providers: ['billing'],
    });
    expect(requests.map((request) => request.authorization)).toEqual(['Bearer bob-billing-token']);
  });

  it('leaves a binding it does not map to the credentials option', async () => {
    const result = await runWorkflowAs(CAROL, 'return await callTool("getUsage", {})');

    expect(result).toMatchObject({ success: true, value: { account: 'reports' } });
    expect(requests.map((request) => request.authorization)).toEqual(['Bearer reports-token']);
  });
});

describe('execute_action on a binding the authProviders option maps', () => {
  async function executeAs(caller: DirectAuthContext, target: DirectMcpServer = server) {
    return target.callTool('execute_action', { actionId: 'getBalance' }, { authContext: caller });
  }

  it("sends the caller's own connected credential", async () => {
    const result = await executeAs(BOB);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ account: 'bob' });
    expect(requests.map((request) => request.authorization)).toEqual(['Bearer bob-billing-token']);
  });

  it("raises the operation tool's ToolCredentialsRequiredError for a caller who has not connected it, sending nothing", async () => {
    const call = executeAs(CAROL);

    await expect(call).rejects.toBeInstanceOf(ToolCredentialsRequiredError);
    await expect(call).rejects.toMatchObject({ toolId: 'acme:billing.getBalance', providers: ['billing'] });
    expect(requests).toEqual([]);
  });

  it('raises it as execute_action without operation tools', async () => {
    const withoutOperationTools = await FrontMcpInstance.createDirect({
      info: { name: 'billing', version: '1.0.0' },
      apps: [],
      plugins: [
        SkilledOpenApiPlugin.init({
          source: { type: 'inline', content: bundle },
          dev: true,
          authProviders: { 'billing-token': 'billing' },
          exposeOperationsAsInternalTools: false,
        }),
      ],
      providers: [authProvidersVault()],
      logging: { level: LogLevel.Off },
    } as never);
    try {
      expect((await executeAs(BOB, withoutOperationTools)).structuredContent).toEqual({ account: 'bob' });

      const call = executeAs(CAROL, withoutOperationTools);

      await expect(call).rejects.toBeInstanceOf(ToolCredentialsRequiredError);
      await expect(call).rejects.toMatchObject({ toolId: 'execute_action', providers: ['billing'] });
      expect(requests.map((request) => request.authorization)).toEqual(['Bearer bob-billing-token']);
    } finally {
      await withoutOperationTools.dispose();
    }
  });
});

describe('a custom resolver', () => {
  const asked: CredentialResolveOptions[] = [];

  /** Picks the reports token of the caller's tenant, by the `tenant` claim. */
  class TenantResolver extends SkilledOpenApiCredentialResolver {
    async resolve(ref: string, opts: CredentialResolveOptions): Promise<string | undefined> {
      asked.push(opts);
      const tenant = opts.authInfo.user?.['tenant'];
      return ref === 'reports-token' && typeof tenant === 'string' ? `${tenant}-reports-token` : undefined;
    }
  }

  let tenantServer: DirectMcpServer;

  beforeAll(async () => {
    tenantServer = await FrontMcpInstance.createDirect({
      info: { name: 'tenants', version: '1.0.0' },
      apps: [],
      plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, dev: true })],
      providers: [{ provide: SkilledOpenApiCredentialResolver, useValue: new TenantResolver() }],
      logging: { level: LogLevel.Off },
    } as never);
    await tenantServer.listTools({ authContext: ALICE });
  });

  afterAll(async () => {
    await tenantServer?.dispose();
  });

  it("is told the caller, and sends each caller's tenant credential", async () => {
    const acme: DirectAuthContext = { sessionId: 'acme-user', user: { sub: 'dana', tenant: 'acme' } };
    const globex: DirectAuthContext = { sessionId: 'globex-user', user: { sub: 'eli', tenant: 'globex' } };

    const [fromAcme, fromGlobex] = await Promise.all([
      runWorkflowAs(acme, 'return await callTool("getUsage", {})', tenantServer),
      runWorkflowAs(globex, 'return await callTool("getUsage", {})', tenantServer),
    ]);

    expect(fromAcme).toMatchObject({ success: true, value: { account: 'acme' } });
    expect(fromGlobex).toMatchObject({ success: true, value: { account: 'globex' } });
    expect(asked).toEqual(
      expect.arrayContaining([
        { bundleId: 'acme:billing', authInfo: expect.objectContaining({ user: expect.objectContaining(acme.user) }) },
        { bundleId: 'acme:billing', authInfo: expect.objectContaining({ user: expect.objectContaining(globex.user) }) },
      ]),
    );
  });
});
