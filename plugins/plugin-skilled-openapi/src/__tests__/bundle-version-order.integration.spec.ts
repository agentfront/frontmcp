// A real server whose saas source pulls and takes pushes applies a bundle only when it is not older than the one it
// serves, unless the source allows a rollback; the cache keeps the bundle it serves.
import 'reflect-metadata';

import { BundleStore, type BundleCacheStore, type ResolvedBundle } from '@frontmcp/adapters/skills';
import { createWebFetchHandler, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';
import { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN, type SkilledOpenApiRuntimeDeps } from '../skilled-openapi.plugin';
import { BundleSyncService } from '../sync/bundle-sync.service';
import { AUDIENCE, bundle, ENDPOINT, ISSUER, JWKS_URL, signed, tokenIssuer, trustedKey } from './saas-bundles.fixture';

const PUSH_URL = 'http://localhost/__skilled_openapi/push';

interface VersionedServer {
  servedVersion: () => string | undefined;
  /** Pull the published bundle, as a Worker's Cron run does. */
  refresh: () => Promise<void>;
  push: (pushed: ResolvedBundle) => Promise<Response>;
}

describe('the version order of a saas source', () => {
  let issuer: Awaited<ReturnType<typeof tokenIssuer>>;
  let published: ResolvedBundle | 'outage';
  let fetchMock: jest.SpyInstance;
  let storedBundle: ResolvedBundle | undefined;
  const keptVersions: string[] = [];
  const cache: BundleCacheStore = {
    read: async () => storedBundle,
    write: async (kept) => {
      storedBundle = kept;
      keptVersions.push(kept.version);
    },
  };

  async function startServer({ allowRollback }: { allowRollback?: boolean } = {}): Promise<VersionedServer> {
    let refresher: { refresh(): Promise<void> } | undefined;
    const runtimeDeps: SkilledOpenApiRuntimeDeps = {
      cache,
      disablePolling: true,
      attach: (attached) => {
        refresher = attached;
      },
    };
    const instance = await FrontMcpInstance.createForGraph({
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
            enableWebhook: true,
            allowRollback,
          },
          trustedKeys: [trustedKey],
        }),
      ],
      providers: [{ name: 'test:runtime-deps', provide: SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN, useValue: runtimeDeps }],
      logging: { level: LogLevel.Off },
    } as never);
    const scope = instance.getPrimaryScope();
    if (!scope) throw new Error('the server config produced no scope');
    await instance.emitProvidersReady();
    await scope.providers.get(BundleSyncService).ensureReady();
    const handler = createWebFetchHandler(scope as Parameters<typeof createWebFetchHandler>[0]);
    return {
      servedVersion: () => scope.providers.get(BundleStore).current()?.version,
      refresh: async () => {
        if (!refresher) throw new Error('the plugin attached no refresh');
        await refresher.refresh();
      },
      push: async (pushed) =>
        handler(
          new Request(PUSH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${await issuer.pushToken()}` },
            body: JSON.stringify(pushed),
          }),
        ),
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
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  beforeEach(() => {
    storedBundle = undefined;
    keptVersions.length = 0;
    published = signed(bundle('2.0.0', ['invoices']));
  });

  it('applies and keeps a newer bundle, pulled or pushed', async () => {
    const server = await startServer();
    published = signed(bundle('2.1.0', ['invoices']));

    await server.refresh();
    const pushed = await server.push(signed(bundle('3.0.0', ['invoices', 'refunds'])));

    expect(pushed.status).toBe(200);
    expect(server.servedVersion()).toBe('3.0.0');
    expect(keptVersions).toEqual(['2.0.0', '2.1.0', '3.0.0']);
  });

  it('neither applies nor keeps an older pulled bundle', async () => {
    const server = await startServer();
    published = signed(bundle('1.0.0', ['invoices', 'refunds']));

    await server.refresh();

    expect(server.servedVersion()).toBe('2.0.0');
    expect(keptVersions).toEqual(['2.0.0']);
  });

  it('refuses an older pushed bundle with 409 bundle_outdated, and the served bundle stays', async () => {
    const server = await startServer();

    const response = await server.push(signed(bundle('1.5.0', ['refunds'])));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'bundle_outdated',
      error_description:
        'bundle acme:billing@1.5.0 was not applied: older than the served bundle acme:billing@2.0.0 (generatedAt 2026-11-04T12:00:00.000Z)',
    });
    expect(server.servedVersion()).toBe('2.0.0');
    expect(keptVersions).toEqual(['2.0.0']);
  });

  it('applies and keeps an older bundle, pulled or pushed, when the source allows a rollback', async () => {
    const server = await startServer({ allowRollback: true });
    published = signed(bundle('1.5.0', ['invoices']));

    await server.refresh();
    const pushed = await server.push(signed(bundle('1.0.0', ['invoices'])));

    expect(pushed.status).toBe(200);
    expect(server.servedVersion()).toBe('1.0.0');
    expect(keptVersions).toEqual(['2.0.0', '1.5.0', '1.0.0']);
  });

  it('serves the cached bundle at a start the bundle server misses, after an older bundle was refused', async () => {
    const server = await startServer();
    await server.push(signed(bundle('1.0.0', ['refunds'])));
    published = 'outage';

    const restarted = await startServer();

    expect(restarted.servedVersion()).toBe('2.0.0');
  });
});
