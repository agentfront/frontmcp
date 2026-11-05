// A real server whose saas source is down when it starts: the SDK's skill surfaces and initialize say the skills
// haven't loaded, with the retryable error the plugin's tools answer, instead of an empty catalog a client caches.
// Once a refresh applies the bundle they list its skills with bundleVersion, and connected clients are told.
import 'reflect-metadata';

import type { BundleCacheStore, ResolvedBundle } from '@frontmcp/adapters/skills';
import { McpError } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';
import { connect, createInMemoryServer, FrontMcpInstance, LogLevel, z, type DirectClient } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin, type BundleSyncOutcome } from '../index';
import { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN, type SkilledOpenApiRuntimeDeps } from '../skilled-openapi.plugin';
import { AUDIENCE, bundle, ENDPOINT, ISSUER, JWKS_URL, signed, tokenIssuer, trustedKey } from './saas-bundles.fixture';

const skillsListSchema = z
  .object({ skills: z.array(z.object({ id: z.string(), bundleVersion: z.string().optional() }).passthrough()) })
  .passthrough();
const readResourceSchema = z
  .object({ contents: z.array(z.object({ uri: z.string(), text: z.string().optional() }).passthrough()) })
  .passthrough();
const toolResultSchema = z
  .object({ isError: z.boolean().optional(), _meta: z.record(z.string(), z.unknown()).optional() })
  .passthrough();

async function rejectionOf(answer: Promise<unknown>): Promise<McpError> {
  const error = await answer.then(
    () => undefined,
    (rejected: unknown) => rejected,
  );
  if (!(error instanceof McpError)) throw new Error(`expected an McpError, got ${String(error)}`);
  return error;
}

function expectNotLoaded(error: McpError): void {
  expect(error.message).toContain('No skill bundle is loaded: ');
  expect(error.data).toMatchObject({ code: 'SKILL_BUNDLE_NOT_LOADED', retryable: true });
}

describe('the SDK skill surfaces of a server whose saas source is down at startup', () => {
  let published: ResolvedBundle | 'outage' = 'outage';
  let issuer: Awaited<ReturnType<typeof tokenIssuer>>;
  let fetchMock: jest.SpyInstance;
  let refresher: { refresh(): Promise<BundleSyncOutcome> } | undefined;
  let client: Client;
  let closeServer: () => Promise<void>;
  const notifications: string[] = [];
  const emptyCache: BundleCacheStore = { read: async () => undefined, write: async () => undefined };

  /** A server that pulls from the mocked bundle server, as a Worker does: no polling, refreshed by `attach`'s caller. */
  async function serverConfig(attach: SkilledOpenApiRuntimeDeps['attach'] = () => undefined) {
    const runtimeDeps: SkilledOpenApiRuntimeDeps = { cache: emptyCache, disablePolling: true, attach };
    return {
      info: { name: 'billing', version: '1.0.0' },
      apps: [],
      serve: false,
      instructionsBudget: false,
      plugins: [
        SkilledOpenApiPlugin.init({
          source: {
            type: 'saas',
            endpoint: ENDPOINT,
            authToken: await issuer.sign({}),
            expectedAudience: AUDIENCE,
            jwksUrl: JWKS_URL,
            expectedIssuer: ISSUER,
          },
          trustedKeys: [trustedKey],
        }),
      ],
      providers: [{ name: 'test:runtime-deps', provide: SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN, useValue: runtimeDeps }],
      logging: { level: LogLevel.Off },
    };
  }

  beforeAll(async () => {
    issuer = await tokenIssuer('cloud-2026');
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === JWKS_URL) return Response.json(issuer.jwks);
      if (url !== ENDPOINT) return new Response('not found', { status: 404 });
      if (published === 'outage') throw new TypeError('fetch failed');
      return Response.json(published);
    });
    const config = await serverConfig((attached) => {
      refresher = attached;
    });
    const instance = await FrontMcpInstance.createForGraph(config as never);
    const scope = instance.getPrimaryScope();
    if (!scope) throw new Error('the server config produced no scope');
    await instance.emitProvidersReady();
    const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    client = new Client({ name: 'skills-while-down', version: '1.0.0' });
    client.fallbackNotificationHandler = async ({ method }) => {
      notifications.push(method);
    };
    await client.connect(clientTransport);
    closeServer = close;
  });

  afterAll(async () => {
    await client?.close();
    await closeServer?.();
    fetchMock?.mockRestore();
  });

  it('says at initialize that the skills have not loaded yet', () => {
    expect(client.getInstructions()).toContain("This server's skills have not loaded yet (");
    expect(client.getInstructions()).toContain('Ask for them again shortly');
  });

  it('answers skills/list, skills/search and skill://index.json with the retryable SKILL_BUNDLE_NOT_LOADED error', async () => {
    expectNotLoaded(await rejectionOf(client.request({ method: 'skills/list', params: {} }, skillsListSchema)));
    expectNotLoaded(
      await rejectionOf(client.request({ method: 'skills/search', params: { query: 'invoices' } }, skillsListSchema)),
    );
    expectNotLoaded(
      await rejectionOf(
        client.request({ method: 'resources/read', params: { uri: 'skill://index.json' } }, readResourceSchema),
      ),
    );
  });

  it("answers with the same code and reason as the plugin's own tools", async () => {
    const listError = await rejectionOf(client.request({ method: 'skills/list', params: {} }, skillsListSchema));
    const toolResult = await client.request(
      { method: 'tools/call', params: { name: 'search_skill', arguments: { query: 'invoices' } } },
      toolResultSchema,
    );
    const toolText = (toolResult['content'] as Array<{ text: string }>)[0]?.text ?? '';

    expect(toolResult.isError).toBe(true);
    expect(toolResult._meta).toMatchObject({ code: 'SKILL_BUNDLE_NOT_LOADED', retryable: true });
    expect(toolText.startsWith('No skill bundle is loaded: ')).toBe(true);
    expect(listError.message).toContain(toolText);
  });

  describe('a direct client, on a server of its own that is down too', () => {
    let direct: DirectClient;

    beforeAll(async () => {
      direct = await connect((await serverConfig()) as never);
    });

    afterAll(async () => {
      await direct?.close();
    });

    it('gets the retryable error from skills/list and skill://index.json', async () => {
      expectNotLoaded(await rejectionOf(direct.listSkills()));
      expectNotLoaded(await rejectionOf(direct.readResource('skill://index.json')));
    });
  });

  it('lists the skills with their bundleVersion once a refresh applies the bundle, after a list_changed', async () => {
    published = signed(bundle('1.4.0', ['invoices']));
    if (!refresher) throw new Error('the plugin attached no refresh');
    const outcome = await refresher.refresh();

    const listed = await client.request({ method: 'skills/list', params: {} }, skillsListSchema);
    const index = await client.request(
      { method: 'resources/read', params: { uri: 'skill://index.json' } },
      readResourceSchema,
    );

    expect(outcome.status).toBe('applied');
    expect(listed.skills).toEqual([expect.objectContaining({ id: 'invoices', bundleVersion: '1.4.0' })]);
    expect(index.contents[0]?.text).toContain('skill://invoices/SKILL.md');
    expect(notifications).toContain('notifications/skills/list_changed');
  });
});
