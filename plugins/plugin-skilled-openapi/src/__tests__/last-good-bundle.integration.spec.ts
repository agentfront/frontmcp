// A real server whose saas source pulls signed bundles keeps only the bundles it applied, and serves the last of them
// when it restarts while the bundle server is down.
import 'reflect-metadata';

import {
  BundleStore,
  type BundleCacheStore,
  type ResolvedBundle,
  type SkillBundleSource,
} from '@frontmcp/adapters/skills';
import { FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';
import { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN, type SkilledOpenApiRuntimeDeps } from '../skilled-openapi.plugin';
import { BundleSyncService } from '../sync/bundle-sync.service';
import { AUDIENCE, bundle, ENDPOINT, ISSUER, JWKS_URL, signed, tokenIssuer, trustedKey } from './saas-bundles.fixture';

interface PullingServer {
  servedVersion: () => string | undefined;
  /** Pull the published bundle, as a Worker's Cron run does. */
  refresh: () => Promise<unknown>;
}

describe('the last good bundle of a saas source', () => {
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

  async function startServer(): Promise<PullingServer> {
    let source: SkillBundleSource | undefined;
    const runtimeDeps: SkilledOpenApiRuntimeDeps = {
      cache,
      disablePolling: true,
      attach: (attached) => {
        source = attached;
      },
    };
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'billing', version: '1.0.0' },
      apps: [],
      serve: false,
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
    } as never);
    const scope = instance.getPrimaryScope();
    if (!scope) throw new Error('the server config produced no scope');
    await instance.emitProvidersReady();
    await scope.providers.get(BundleSyncService).ensureReady();
    return {
      servedVersion: () => scope.providers.get(BundleStore).current()?.version,
      refresh: async () => {
        if (!source?.refresh) throw new Error('the plugin attached no refreshable source');
        return source.refresh();
      },
    };
  }

  let server: PullingServer;

  beforeAll(async () => {
    issuer = await tokenIssuer('cloud-2026');
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === JWKS_URL) return Response.json(issuer.jwks);
      if (url !== ENDPOINT) return new Response('not found', { status: 404 });
      if (published === 'outage') throw new TypeError('fetch failed');
      return Response.json(published);
    });
    published = signed(bundle('1.0.0', ['invoices']));
    server = await startServer();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  it('keeps the bundle pulled at startup once it is applied', () => {
    expect(server.servedVersion()).toBe('1.0.0');
    expect(keptVersions).toEqual(['1.0.0']);
  });

  it('does not keep a pulled bundle whose signature check fails, and the bundle before keeps serving', async () => {
    const signedBundle = signed(bundle('2.0.0', ['invoices']));
    published = { ...signedBundle, skills: [...signedBundle.skills, ...bundle('2.0.0', ['refunds']).skills] };

    await server.refresh();

    expect(server.servedVersion()).toBe('1.0.0');
    expect(keptVersions).toEqual(['1.0.0']);
  });

  it('serves the last bundle applied when it restarts while the bundle server is down', async () => {
    published = 'outage';

    const restarted = await startServer();

    expect(restarted.servedVersion()).toBe('1.0.0');
  });

  it('keeps a newer pulled bundle once it is applied, by the time the refresh that pulled it resolves', async () => {
    published = signed(bundle('3.0.0', ['invoices', 'refunds']));

    await server.refresh();
    const keptAfterRefresh = keptVersions.at(-1);
    published = 'outage';
    const restarted = await startServer();

    expect(server.servedVersion()).toBe('3.0.0');
    expect(keptAfterRefresh).toBe('3.0.0');
    expect(restarted.servedVersion()).toBe('3.0.0');
  });
});
