import type { ResolvedBundle } from '../bundle/bundle.types';
import type { NpmSourceOptions } from '../skilled-openapi.types';
import { NpmSource } from '../sources/npm.source';

const baseBundle = {
  schemaVersion: 1,
  bundleId: 'npm:acme',
  version: '1',
  generatedAt: '2026-05-04T00:00:00Z',
  sourceDigest: 'c'.repeat(64),
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

class FakeNpmSource extends NpmSource {
  constructor(
    options: NpmSourceOptions,
    public stub: (specifier: string) => Promise<any>,
  ) {
    super(options, fakeLogger);
  }
  protected override dynamicImport(specifier: string) {
    return this.stub(specifier);
  }
}

describe('NpmSource', () => {
  it('loads bundle from package default export', async () => {
    const source = new FakeNpmSource(
      { type: 'npm', packageName: '@acme/bundle', verifyProvenance: false },
      async () => ({ default: baseBundle }),
    );
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    await source.start();
    await source.stop();
    expect(events).toHaveLength(1);
    expect(events[0].bundleId).toBe('npm:acme');
  });

  it('loads bundle from a named export', async () => {
    const source = new FakeNpmSource(
      { type: 'npm', packageName: '@acme/bundle', exportName: 'frontmcpBundle', verifyProvenance: false },
      async () => ({ frontmcpBundle: baseBundle }),
    );
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    await source.start();
    await source.stop();
    expect(events).toHaveLength(1);
  });

  it('warns when verifyProvenance=true (provenance check not yet implemented)', async () => {
    const warnSpy = jest.spyOn(fakeLogger as never as { warn: (m: string) => void }, 'warn');
    const source = new FakeNpmSource(
      { type: 'npm', packageName: '@acme/bundle', verifyProvenance: true },
      async () => ({ default: baseBundle }),
    );
    source.onChange(() => {});
    await source.start();
    expect(warnSpy).toHaveBeenCalled();
    await source.stop();
  });

  it('throws when the named export is missing', async () => {
    const source = new FakeNpmSource(
      { type: 'npm', packageName: '@acme/bundle', exportName: 'missing', verifyProvenance: false },
      async () => ({ default: baseBundle }),
    );
    await expect(source.start()).rejects.toThrow(/export "missing" not found/);
  });

  it('replays last bundle to late subscribers', async () => {
    const source = new FakeNpmSource(
      { type: 'npm', packageName: '@acme/bundle', verifyProvenance: false },
      async () => ({ default: baseBundle }),
    );
    await source.start();
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    expect(events).toHaveLength(1);
    await source.stop();
  });

  it('throws if dynamic import rejects', async () => {
    const source = new FakeNpmSource(
      { type: 'npm', packageName: '@nope/missing', verifyProvenance: false },
      async () => {
        throw new Error('cannot find module');
      },
    );
    await expect(source.start()).rejects.toThrow(/cannot find module/);
  });
});
