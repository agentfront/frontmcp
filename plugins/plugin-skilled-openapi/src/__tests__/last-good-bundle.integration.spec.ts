// A real server whose saas source pulls signed bundles keeps only the bundles it applied, and serves the last of them
// when it restarts while the bundle server is down, serves an older bundle, or serves one it refuses; serving it writes
// nothing to the cache. Its refresh is the one a Worker's Cron run calls.
import 'reflect-metadata';

import { BundleStore, type BundleCacheStore, type ResolvedBundle } from '@frontmcp/adapters/skills';
import { FrontMcpInstance, LogLevel, type HealthProbeResult, type Scope } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin, type BundleSyncOutcome } from '../index';
import { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN, type SkilledOpenApiRuntimeDeps } from '../skilled-openapi.plugin';
import { BundleSyncService } from '../sync/bundle-sync.service';
import { AUDIENCE, bundle, ENDPOINT, ISSUER, JWKS_URL, signed, tokenIssuer, trustedKey } from './saas-bundles.fixture';

interface PullingServer {
  servedVersion: () => string | undefined;
  /** Pull the published bundle, as a Worker's Cron run does. */
  refresh: () => Promise<BundleSyncOutcome>;
  /** The plugin's check, as `/readyz` answers it. */
  health: () => Promise<HealthProbeResult | undefined>;
}

describe('the last good bundle of a saas source', () => {
  let issuer: Awaited<ReturnType<typeof tokenIssuer>>;
  let published: ResolvedBundle | 'outage';
  let jwksAvailable = true;
  let fetchMock: jest.SpyInstance;
  let pulls = 0;
  let storedBundle: ResolvedBundle | undefined;
  const keptVersions: string[] = [];
  const cache: BundleCacheStore = {
    read: async () => storedBundle,
    write: async (kept) => {
      storedBundle = kept;
      keptVersions.push(kept.version);
    },
  };

  /**
   * Build a server that pulls with `authToken`, by default one the issuer signed for it; unless `cold`, a first request
   * has started its bundle sync. No instructions budget starts it.
   */
  async function startServer({
    cold = false,
    authToken,
  }: { cold?: boolean; authToken?: string } = {}): Promise<PullingServer> {
    let refresher: { refresh(): Promise<BundleSyncOutcome> } | undefined;
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
      health: { includeDetails: true },
      plugins: [
        SkilledOpenApiPlugin.init({
          source: {
            type: 'saas',
            endpoint: ENDPOINT,
            authToken: authToken ?? (await issuer.sign({})),
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
    const scope = instance.getPrimaryScope() as Scope | undefined;
    if (!scope) throw new Error('the server config produced no scope');
    await instance.emitProvidersReady();
    if (!cold) await scope.providers.get(BundleSyncService).ensureReady();
    return {
      servedVersion: () => scope.providers.get(BundleStore).current()?.version,
      refresh: async () => {
        if (!refresher) throw new Error('the plugin attached no refresh');
        return refresher.refresh();
      },
      health: async () => (await scope.healthService?.getReadyz())?.probes?.['skilled-openapi'],
    };
  }

  let server: PullingServer;

  beforeAll(async () => {
    issuer = await tokenIssuer('cloud-2026');
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === JWKS_URL) {
        if (!jwksAvailable) throw new TypeError('fetch failed');
        return Response.json(issuer.jwks);
      }
      if (url !== ENDPOINT) return new Response('not found', { status: 404 });
      if (published === 'outage') throw new TypeError('fetch failed');
      pulls++;
      return Response.json(published);
    });
    published = signed(bundle('1.0.0', ['invoices']));
    server = await startServer();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  it('keeps the bundle pulled at startup once it is applied, and its check is healthy', async () => {
    expect(server.servedVersion()).toBe('1.0.0');
    expect(keptVersions).toEqual(['1.0.0']);
    expect(await server.health()).toEqual({
      status: 'healthy',
      details: { state: 'loaded', bundleId: 'acme:billing', bundleVersion: '1.0.0' },
    });
  });

  it('does not keep a pulled bundle whose signature check fails: the refresh says it was refused, the check that the served one is stale', async () => {
    const signedBundle = signed(bundle('2.0.0', ['invoices']));
    published = { ...signedBundle, skills: [...signedBundle.skills, ...bundle('2.0.0', ['refunds']).skills] };

    const outcome = await server.refresh();

    expect(outcome).toEqual({
      status: 'refused',
      bundleId: 'acme:billing',
      bundleVersion: '2.0.0',
      reason: expect.stringContaining('digest mismatch'),
      at: expect.any(String),
    });
    expect(server.servedVersion()).toBe('1.0.0');
    expect(keptVersions).toEqual(['1.0.0']);
    expect(await server.health()).toEqual({
      status: 'degraded',
      details: { state: 'stale', bundleId: 'acme:billing', bundleVersion: '1.0.0', lastSync: outcome },
    });
  });

  it('serves the last bundle applied when it restarts while the bundle server is down, says it is stale, and does not write it back', async () => {
    published = 'outage';
    const keptBeforeRestart = [...keptVersions];

    const restarted = await startServer();

    expect(restarted.servedVersion()).toBe('1.0.0');
    expect(keptVersions).toEqual(keptBeforeRestart);
    expect(await restarted.health()).toMatchObject({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleVersion: '1.0.0',
        lastSync: { status: 'failed', reason: 'fetch failed', cacheFallback: true },
      },
    });
  });

  it('keeps a newer pulled bundle once it is applied, by the time the refresh that pulled it resolves', async () => {
    published = signed(bundle('3.0.0', ['invoices', 'refunds']));

    const outcome = await server.refresh();
    const keptAfterRefresh = keptVersions.at(-1);
    published = 'outage';
    const restarted = await startServer();

    expect(outcome).toMatchObject({ status: 'applied', bundleVersion: '3.0.0' });
    expect(server.servedVersion()).toBe('3.0.0');
    expect(await server.health()).toMatchObject({ status: 'healthy' });
    expect(keptAfterRefresh).toBe('3.0.0');
    expect(restarted.servedVersion()).toBe('3.0.0');
  });

  it('applies and keeps the pulled bundle on a refresh before any request, with one pull, then pulls on the next', async () => {
    published = signed(bundle('4.0.0', ['invoices']));
    const cold = await startServer({ cold: true });
    const pullsBefore = pulls;

    await cold.refresh();
    const afterFirstRefresh = { served: cold.servedVersion(), kept: keptVersions.at(-1), pulls: pulls - pullsBefore };
    published = signed(bundle('5.0.0', ['invoices']));
    await cold.refresh();

    expect(afterFirstRefresh).toEqual({ served: '4.0.0', kept: '4.0.0', pulls: 1 });
    expect(cold.servedVersion()).toBe('5.0.0');
    expect(keptVersions.at(-1)).toBe('5.0.0');
    expect(pulls - pullsBefore).toBe(2);
  });

  it('names the check that refused the pull token in its check, and keeps the reason clients read as it was', async () => {
    published = signed(bundle('6.0.0', ['invoices']));

    const refused = await startServer({ authToken: await issuer.sign({ iss: 'https://impostor.example' }) });
    const check = await refused.health();

    expect(refused.servedVersion()).toBeUndefined();
    expect(check).toMatchObject({
      status: 'unhealthy',
      details: { state: 'failed', lastSync: { status: 'failed', tokenFailure: 'wrong_issuer', cacheFallback: false } },
    });
    expect(check?.error).toMatch(/^no skill bundle is loaded: \[saas-source\] pull token rejected: not a valid token/);
    expect(check?.error).not.toContain('wrong_issuer');
  });

  it('serves the cached bundle on a Cron run that restarts it against a bundle server serving an older one', async () => {
    published = signed(bundle('4.5.0', ['invoices']));
    const keptBeforeRestart = [...keptVersions];
    const restarted = await startServer({ cold: true });

    const outcome = await restarted.refresh();

    expect(outcome).toEqual({
      status: 'refused',
      bundleId: 'acme:billing',
      bundleVersion: '4.5.0',
      reason: 'older than the cached bundle acme:billing@5.0.0 (generatedAt 2026-11-04T12:00:00.000Z)',
      cacheFallback: true,
      at: expect.any(String),
    });
    expect(restarted.servedVersion()).toBe('5.0.0');
    expect(keptVersions).toEqual(keptBeforeRestart);
    expect(await restarted.health()).toEqual({
      status: 'degraded',
      details: { state: 'stale', bundleId: 'acme:billing', bundleVersion: '5.0.0', lastSync: outcome },
    });
  });

  it('serves the cached bundle when it restarts and the bundle it pulls is refused for its signature', async () => {
    const signedBundle = signed(bundle('7.0.0', ['invoices']));
    published = { ...signedBundle, skills: [...signedBundle.skills, ...bundle('7.0.0', ['refunds']).skills] };
    const keptBeforeRestart = [...keptVersions];

    const restarted = await startServer();

    expect(restarted.servedVersion()).toBe('5.0.0');
    expect(keptVersions).toEqual(keptBeforeRestart);
    expect(await restarted.health()).toMatchObject({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleVersion: '5.0.0',
        lastSync: {
          status: 'refused',
          bundleVersion: '7.0.0',
          reason: expect.stringContaining('digest mismatch'),
          cacheFallback: true,
        },
      },
    });
  });

  it('names jwks_unavailable when a refresh cannot read the JWKS, and stays ready on the bundle it serves', async () => {
    jwksAvailable = false;

    try {
      const outcome = await server.refresh();

      expect(outcome).toMatchObject({ status: 'failed', reason: 'fetch failed', tokenFailure: 'jwks_unavailable' });
      expect(await server.health()).toMatchObject({
        status: 'degraded',
        details: { state: 'stale', lastSync: { tokenFailure: 'jwks_unavailable' } },
      });
    } finally {
      jwksAvailable = true;
    }
  });
});
