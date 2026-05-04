import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FrontMcpLogger } from '@frontmcp/sdk';

import type { ResolvedBundle } from '../bundle/bundle.types';
import { StaticSource } from '../sources/static.source';

const baseBundle = {
  schemaVersion: 1,
  bundleId: 'static:test',
  version: '1',
  generatedAt: '2026-05-04T00:00:00Z',
  sourceDigest: 'a'.repeat(64),
  services: [{ id: 'svc', baseUrl: 'https://example.com' }],
  authBindings: { def: { kind: 'none' as const } },
  skills: [{ id: 's', name: 'S', description: 'd', instructions: '# X', operationIds: [] }],
  operations: {},
};

const makeLogger = (): FrontMcpLogger => {
  const logger: Partial<FrontMcpLogger> & { child: jest.Mock } = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger as FrontMcpLogger);
  return logger as FrontMcpLogger;
};

const fakeLogger: FrontMcpLogger = makeLogger();

describe('StaticSource', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'static-source-'));
  });
  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('loads JSON bundle from file', async () => {
    const file = path.join(tmpDir, 'bundle.json');
    await fs.writeFile(file, JSON.stringify(baseBundle), 'utf8');

    const source = new StaticSource({ type: 'static', path: file, watch: false }, fakeLogger);
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));

    await source.start();
    await source.stop();

    expect(events).toHaveLength(1);
    expect(events[0].bundleId).toBe('static:test');
  });

  it('loads YAML bundle from file by extension', async () => {
    const yamlContent = `schemaVersion: 1
bundleId: static:yaml
version: '1'
generatedAt: '2026-05-04T00:00:00Z'
sourceDigest: ${'b'.repeat(64)}
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
    const file = path.join(tmpDir, 'bundle.yaml');
    await fs.writeFile(file, yamlContent, 'utf8');

    const source = new StaticSource({ type: 'static', path: file, watch: false }, fakeLogger);
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));

    await source.start();
    await source.stop();

    expect(events).toHaveLength(1);
    expect(events[0].bundleId).toBe('static:yaml');
  });

  it('sniffs format when extension is unknown', async () => {
    const file = path.join(tmpDir, 'bundle.txt');
    await fs.writeFile(file, JSON.stringify(baseBundle), 'utf8');

    const source = new StaticSource({ type: 'static', path: file, watch: false }, fakeLogger);
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));

    await source.start();
    await source.stop();

    expect(events).toHaveLength(1);
  });

  it('throws on missing file', async () => {
    const source = new StaticSource({ type: 'static', path: path.join(tmpDir, 'nope.json'), watch: false }, fakeLogger);
    await expect(source.start()).rejects.toBeTruthy();
  });

  it('throws on invalid bundle content', async () => {
    const file = path.join(tmpDir, 'bad.json');
    await fs.writeFile(file, JSON.stringify({ totally: 'wrong' }), 'utf8');

    const source = new StaticSource({ type: 'static', path: file, watch: false }, fakeLogger);
    await expect(source.start()).rejects.toBeTruthy();
  });

  it('watch=true notifies listeners again after the file changes', async () => {
    const file = path.join(tmpDir, 'bundle.json');
    await fs.writeFile(file, JSON.stringify(baseBundle), 'utf8');

    const source = new StaticSource({ type: 'static', path: file, watch: true }, fakeLogger);
    const events: ResolvedBundle[] = [];
    source.onChange((b) => events.push(b));
    await source.start();
    expect(events).toHaveLength(1);

    // Modify the file and wait for the debounced refresh (250ms in source).
    await new Promise((r) => setTimeout(r, 50));
    const updated = { ...baseBundle, version: '2' };
    await fs.writeFile(file, JSON.stringify(updated), 'utf8');

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && events.length < 2) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await source.stop();
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('refresh failure (file becomes invalid) is logged but does not throw', async () => {
    const file = path.join(tmpDir, 'bundle.json');
    await fs.writeFile(file, JSON.stringify(baseBundle), 'utf8');

    const warn = jest.fn();
    const logger: FrontMcpLogger = { ...makeLogger(), warn };
    const source = new StaticSource({ type: 'static', path: file, watch: true }, logger);
    source.onChange(() => {});
    await source.start();

    await new Promise((r) => setTimeout(r, 50));
    await fs.writeFile(file, '{ broken json', 'utf8');

    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && warn.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await source.stop();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/refresh failed/));
  });

  it('unsubscribe prevents the listener from firing on subsequent file changes', async () => {
    const file = path.join(tmpDir, 'bundle.json');
    await fs.writeFile(file, JSON.stringify(baseBundle), 'utf8');

    // Watch mode is required so we can trigger a real change event after the
    // initial notification — without it the test can't prove the unsubscribe
    // handle actually detached the listener (a no-op `unsub` would still
    // satisfy "fn called once" because nothing else fires).
    const source = new StaticSource({ type: 'static', path: file, watch: true }, fakeLogger);
    const fn = jest.fn();
    const unsub = source.onChange(fn);
    await source.start();
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();
    // Allow fs.watch to settle before mutating, then write a new bundle and
    // wait past the source's 250ms debounce window.
    await new Promise((r) => setTimeout(r, 50));
    await fs.writeFile(file, JSON.stringify({ ...baseBundle, version: '2' }), 'utf8');
    await new Promise((r) => setTimeout(r, 500));
    await source.stop();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
