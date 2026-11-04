/**
 * Registering the plugin, and replacing its credential resolver, in a real FrontMCP server.
 *
 * In 1.11.0:
 *   - a second `SkilledOpenApiPlugin.init(...)` in one server started without a word, and only one
 *     bundle was served: the other's skills answered "not found" and its actions "unknown action";
 *   - a `SkilledOpenApiCredentialResolver` declared in `@FrontMcp({ providers })` or `@App({ providers })`
 *     was ignored: the plugin's own resolver, which reads `credentials`, kept answering.
 */
import 'reflect-metadata';

import {
  App,
  DuplicatePluginError,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type DirectMcpServer,
  type ProviderType,
} from '@frontmcp/sdk';

import { SkilledOpenApiCredentialResolver, SkilledOpenApiPlugin } from '../index';

const SERVICE_URL = 'https://203.0.113.10/v1';
const VAULT_REF = 'billing-token';

function bundleServing(skillId: string) {
  const operationId = `list_${skillId}`;
  return {
    schemaVersion: 1,
    bundleId: `acme:${skillId}`,
    version: '1.0.0',
    generatedAt: '2026-09-01T12:00:00.000Z',
    sourceDigest: '0'.repeat(64),
    services: [{ id: 'billing', baseUrl: SERVICE_URL }],
    authBindings: { token: { kind: 'bearer', vaultRef: VAULT_REF } },
    skills: [
      {
        id: skillId,
        name: skillId,
        description: `List ${skillId}.`,
        instructions: `# ${skillId}\nUse ${operationId}.`,
        operationIds: [operationId],
      },
    ],
    operations: {
      [operationId]: {
        operationId,
        serviceId: 'billing',
        httpMethod: 'GET',
        pathTemplate: `/${skillId}`,
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object' },
        mapper: [],
        authBindingRef: 'token',
      },
    },
  };
}

function skilledPlugin(skillId: string, providers?: ProviderType[]) {
  return SkilledOpenApiPlugin.init({
    source: { type: 'inline', content: bundleServing(skillId) },
    dev: true,
    credentials: { [VAULT_REF]: 'from-credentials' },
    ...(providers ? { providers } : {}),
  });
}

class RotatingVault {
  readonly lookups: Array<{ ref: string; bundleId: string }> = [];
  secret = 'from-vault';

  async resolve(ref: string, opts: { bundleId: string }): Promise<string | undefined> {
    this.lookups.push({ ref, bundleId: opts.bundleId });
    return this.secret;
  }
}

const vaultProvider = (vault: RotatingVault): ProviderType => ({
  provide: SkilledOpenApiCredentialResolver,
  useValue: vault,
});

@Tool({ name: 'call_operation', inputSchema: {} })
class CallOperationTool extends ToolContext {
  async execute() {
    await this.callTool('acme:invoices.list_invoices', {});
    return 'called';
  }
}

const authorizationHeaders: string[] = [];
const originalFetch = global.fetch;
const servers: DirectMcpServer[] = [];

beforeAll(() => {
  global.fetch = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  authorizationHeaders.length = 0;
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.dispose()));
});

async function startServer(config: Record<string, unknown>, endpoint?: { app: string }): Promise<DirectMcpServer> {
  const server = await FrontMcpInstance.createDirect(
    { info: { name: 'billing', version: '1.0.0' }, apps: [], logging: { level: LogLevel.Off }, ...config } as never,
    endpoint,
  );
  servers.push(server);
  return server;
}

async function loads(server: DirectMcpServer, skillId: string): Promise<boolean> {
  return server.callTool('load_skill', { skillId }).then(
    (result) => !result.isError,
    () => false,
  );
}

async function runOperation(server: DirectMcpServer, skillId: string) {
  const result = await server.callTool('run_workflow', { script: `return await callTool('list_${skillId}', {})` });
  return result.structuredContent as { success: boolean; error?: string };
}

const ONE_PLUGIN_PER_SERVER =
  'Plugin "skilled-openapi" can be installed once per server, and this server installs it twice. ' +
  'One bundle can describe several services, each with its own base URL and auth binding: serve them from one ' +
  'bundle. To serve separate bundles, give each its own app with splitByApp.';

describe('a second Skilled OpenAPI plugin in one server', () => {
  it('fails at startup when the server lists the plugin twice', async () => {
    const started = startServer({ plugins: [skilledPlugin('invoices'), skilledPlugin('customers')] });

    await expect(started).rejects.toThrow(DuplicatePluginError);
    await expect(started).rejects.toThrow(ONE_PLUGIN_PER_SERVER);
  });

  it('fails at startup when the server installs one and an app another', async () => {
    @App({ name: 'customers', plugins: [skilledPlugin('customers')] })
    class CustomersApp {}

    await expect(startServer({ apps: [CustomersApp], plugins: [skilledPlugin('invoices')] })).rejects.toThrow(
      ONE_PLUGIN_PER_SERVER,
    );
  });

  it('fails at startup when two apps of the server each install one', async () => {
    @App({ name: 'invoices', plugins: [skilledPlugin('invoices')] })
    class InvoicesApp {}
    @App({ name: 'customers', plugins: [skilledPlugin('customers')] })
    class CustomersApp {}

    await expect(startServer({ apps: [InvoicesApp, CustomersApp] })).rejects.toThrow(ONE_PLUGIN_PER_SERVER);
  });

  it('serves its bundle when the server installs it once', async () => {
    const server = await startServer({ plugins: [skilledPlugin('invoices')] });

    expect(await loads(server, 'invoices')).toBe(true);
    expect(await runOperation(server, 'invoices')).toMatchObject({ success: true });
  });

  it('serves each app its own bundle on a splitByApp server', async () => {
    @App({ name: 'invoices', plugins: [skilledPlugin('invoices')] })
    class InvoicesApp {}
    @App({ name: 'customers', plugins: [skilledPlugin('customers')] })
    class CustomersApp {}
    const config = { apps: [InvoicesApp, CustomersApp], splitByApp: true };

    const invoices = await startServer(config, { app: 'invoices' });
    const customers = await startServer(config, { app: 'customers' });

    expect([await loads(invoices, 'invoices'), await loads(invoices, 'customers')]).toEqual([true, false]);
    expect([await loads(customers, 'customers'), await loads(customers, 'invoices')]).toEqual([true, false]);
    expect(await runOperation(customers, 'customers')).toMatchObject({ success: true });
  });
});

describe('the credential resolver', () => {
  it('is the one @FrontMcp({ providers }) declares, for workflows and for in-process operation calls', async () => {
    const vault = new RotatingVault();
    @App({ name: 'host', tools: [CallOperationTool] })
    class HostApp {}
    const server = await startServer({
      apps: [HostApp],
      plugins: [skilledPlugin('invoices')],
      providers: [vaultProvider(vault)],
    });

    expect(await runOperation(server, 'invoices')).toMatchObject({ success: true });
    await server.callTool('call_operation', {});

    expect(authorizationHeaders).toEqual(['Bearer from-vault', 'Bearer from-vault']);
    expect(vault.lookups).toEqual([
      { ref: VAULT_REF, bundleId: 'acme:invoices' },
      { ref: VAULT_REF, bundleId: 'acme:invoices' },
    ]);
  });

  it('is the one declared by the @App that installs the plugin', async () => {
    const vault = new RotatingVault();
    @App({ name: 'invoices', plugins: [skilledPlugin('invoices')], providers: [vaultProvider(vault)] })
    class InvoicesApp {}
    const server = await startServer({ apps: [InvoicesApp] });

    expect(await runOperation(server, 'invoices')).toMatchObject({ success: true });

    expect(authorizationHeaders).toEqual(['Bearer from-vault']);
    expect(vault.lookups).toEqual([{ ref: VAULT_REF, bundleId: 'acme:invoices' }]);
  });

  it('is the one init({ providers }) declares', async () => {
    const vault = new RotatingVault();
    const server = await startServer({ plugins: [skilledPlugin('invoices', [vaultProvider(vault)])] });

    expect(await runOperation(server, 'invoices')).toMatchObject({ success: true });

    expect(authorizationHeaders).toEqual(['Bearer from-vault']);
  });

  it('is asked on every call, so a rotated secret is sent without a restart', async () => {
    const vault = new RotatingVault();
    const server = await startServer({ plugins: [skilledPlugin('invoices')], providers: [vaultProvider(vault)] });

    await runOperation(server, 'invoices');
    vault.secret = 'rotated';
    await runOperation(server, 'invoices');

    expect(authorizationHeaders).toEqual(['Bearer from-vault', 'Bearer rotated']);
  });

  it('is the built-in one, which reads credentials, when none is declared', async () => {
    @App({ name: 'host', tools: [CallOperationTool] })
    class HostApp {}
    const server = await startServer({ apps: [HostApp], plugins: [skilledPlugin('invoices')] });

    expect(await runOperation(server, 'invoices')).toMatchObject({ success: true });
    await server.callTool('call_operation', {});

    expect(authorizationHeaders).toEqual(['Bearer from-credentials', 'Bearer from-credentials']);
  });
});
