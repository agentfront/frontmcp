import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ResolvedBundle } from '../bundle/bundle.types';
import type { SaasSourceOptions } from '../source-options';
import { SaasPullSource } from '../sources/saas-pull.source';

const baseBundle = {
  schemaVersion: 1,
  bundleId: 'saas:test',
  version: '1',
  generatedAt: '2026-05-04T00:00:00Z',
  sourceDigest: 'd'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'https://example.com' }],
  authBindings: { def: { kind: 'none' as const } },
  skills: [{ id: 's', name: 'S', description: 'd', instructions: '# X', operationIds: [] }],
  operations: {},
};

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

class FakeSaasSource extends SaasPullSource {
  constructor(
    options: SaasSourceOptions,
    cacheDir: string,
    public stub: (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>,
  ) {
    super(options, cacheDir, fakeLogger);
  }
  protected override async httpGet(url: string, headers: Record<string, string>) {
    return this.stub(url, headers);
  }
}

const baseOptions = (overrides: Partial<SaasSourceOptions> = {}): SaasSourceOptions => ({
  type: 'saas',
  endpoint: 'https://cloud.example.dev/v1/bundles/acme',
  authToken: 'tok',
  expectedAudience: 'acme:prod',
  pollIntervalMs: 60_000,
  enableWebhook: false,
  jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
  expectedIssuer: 'https://cloud.example.dev',
  ...overrides,
});

describe('SaasPullSource', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saas-pull-'));
  });
  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('pulls a bundle on start and notifies listeners', async () => {
    const source = new FakeSaasSource(baseOptions(), tmpDir, async () => ({
      status: 200,
      body: JSON.stringify(baseBundle),
    }));
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    await source.start();
    await source.stop();
    expect(events).toHaveLength(1);
    expect(events[0].bundleId).toBe('saas:test');
  });

  it('sends Authorization: Bearer <authToken>', async () => {
    let seenHeaders: Record<string, string> = {};
    const source = new FakeSaasSource(baseOptions(), tmpDir, async (_u, headers) => {
      seenHeaders = headers;
      return { status: 200, body: JSON.stringify(baseBundle) };
    });
    source.onChange(() => {});
    await source.start();
    await source.stop();
    expect(seenHeaders['Authorization']).toBe('Bearer tok');
  });

  it('persists pulled bundle to cacheDir', async () => {
    const source = new FakeSaasSource(baseOptions(), tmpDir, async () => ({
      status: 200,
      body: JSON.stringify(baseBundle),
    }));
    source.onChange(() => {});
    await source.start();
    await source.stop();

    const cachedPath = path.join(tmpDir, 'acme_prod.json');
    const cached = JSON.parse(await fs.readFile(cachedPath, 'utf8'));
    expect(cached.bundleId).toBe('saas:test');
  });

  it('falls back to cached bundle when pull fails on boot', async () => {
    // Pre-seed cache
    const cachedPath = path.join(tmpDir, 'acme_prod.json');
    await fs.writeFile(cachedPath, JSON.stringify(baseBundle), 'utf8');

    const source = new FakeSaasSource(baseOptions(), tmpDir, async () => ({ status: 503, body: '' }));
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    await source.start();
    await source.stop();
    expect(events).toHaveLength(1);
    expect(events[0].bundleId).toBe('saas:test');
  });

  it('throws when both pull AND cache are unavailable', async () => {
    const source = new FakeSaasSource(baseOptions(), tmpDir, async () => ({ status: 401, body: '' }));
    await expect(source.start()).rejects.toThrow();
  });

  it('rejects non-2xx HTTP responses', async () => {
    const source = new FakeSaasSource(baseOptions(), tmpDir, async () => ({ status: 500, body: '' }));
    await expect(source.start()).rejects.toThrow();
  });

  it('polls again after the configured interval and notifies listeners', async () => {
    let calls = 0;
    const source = new FakeSaasSource(baseOptions({ pollIntervalMs: 50 }), tmpDir, async () => {
      calls++;
      return { status: 200, body: JSON.stringify({ ...baseBundle, version: String(calls) }) };
    });
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    await source.start();
    // Wait for at least one poll iteration after the initial pull.
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && events.length < 2) {
      await new Promise((r) => setTimeout(r, 25));
    }
    await source.stop();
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('logs poll failures without throwing', async () => {
    let calls = 0;
    const warn = jest.fn();
    const logger = { ...fakeLogger, warn } as unknown as never;
    const sourceLoggerInjected = new (class extends SaasPullSource {
      constructor() {
        super(baseOptions({ pollIntervalMs: 50 }), tmpDir, logger);
      }
      protected override async httpGet() {
        calls++;
        if (calls === 1) {
          return { status: 200, body: JSON.stringify(baseBundle) };
        }
        return { status: 502, body: '' };
      }
    })();
    sourceLoggerInjected.onChange(() => {});
    await sourceLoggerInjected.start();
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && warn.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
    await sourceLoggerInjected.stop();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/poll failed/));
  });

  it('skips overlapping polls (single-flight)', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const source = new FakeSaasSource(baseOptions({ pollIntervalMs: 25 }), tmpDir, async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      // Hold the call open longer than the poll interval.
      await new Promise((r) => setTimeout(r, 200));
      inFlight--;
      return { status: 200, body: JSON.stringify(baseBundle) };
    });
    source.onChange(() => {});
    await source.start();
    await new Promise((r) => setTimeout(r, 600));
    await source.stop();
    // The initial pull holds for 200ms; subsequent polls should NOT stack
    // up — the single-flight gate keeps inFlight ≤ 1 at any moment.
    expect(maxConcurrent).toBe(1);
  });

  it('persistCache failures (unwritable cacheDir) are logged but do not abort the pull', async () => {
    const warn = jest.fn();
    const logger = { ...fakeLogger, warn } as unknown as never;
    // /dev/null/badpath is not writable — mkdir will fail.
    const sourceCustom = new (class extends SaasPullSource {
      constructor() {
        super(baseOptions(), '/dev/null/badpath', logger);
      }
      protected override async httpGet() {
        return { status: 200, body: JSON.stringify(baseBundle) };
      }
    })();
    sourceCustom.onChange(() => {});
    await sourceCustom.start();
    await sourceCustom.stop();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/cache persist failed/));
  });

  it('uses DEFAULT_CACHE_DIR when cacheDir is undefined', async () => {
    // We can't easily clean up the default directory, so just assert the
    // pull succeeds and persistCache doesn't throw.
    const source = new FakeSaasSource(baseOptions(), undefined as never, async () => ({
      status: 200,
      body: JSON.stringify(baseBundle),
    }));
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    await source.start();
    await source.stop();
    expect(events).toHaveLength(1);
  });

  it('falls back to cached bundle on second start when fresh pull fails', async () => {
    // First run: persist cache
    const seedSource = new FakeSaasSource(baseOptions(), tmpDir, async () => ({
      status: 200,
      body: JSON.stringify(baseBundle),
    }));
    seedSource.onChange(() => {});
    await seedSource.start();
    await seedSource.stop();

    // Second run: pull fails, but cache is on disk
    const followupSource = new FakeSaasSource(baseOptions(), tmpDir, async () => ({
      status: 503,
      body: '',
    }));
    const events: ResolvedBundle[] = [];
    followupSource.onChange((b) => events.push(b));
    await followupSource.start();
    await followupSource.stop();
    expect(events).toHaveLength(1);
    expect(events[0].bundleId).toBe('saas:test');
  });

  it('parses YAML response body', async () => {
    const yamlBody = `schemaVersion: 1
bundleId: saas:yaml
version: '1'
generatedAt: '2026-05-04T00:00:00Z'
sourceDigest: ${'e'.repeat(64)}
services:
  - id: svc
    baseUrl: https://example.com
authBindings:
  def: { kind: none }
skills:
  - id: s
    name: S
    description: d
    instructions: '# X'
    operationIds: []
operations: {}
`;
    const source = new FakeSaasSource(baseOptions(), tmpDir, async () => ({ status: 200, body: yamlBody }));
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    await source.start();
    await source.stop();
    expect(events).toHaveLength(1);
    expect(events[0].bundleId).toBe('saas:yaml');
  });
});
