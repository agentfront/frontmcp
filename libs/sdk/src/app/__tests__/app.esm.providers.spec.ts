/**
 * The providers of an `App.esm()` package, through a real scope with the package load mocked at the
 * `EsmModuleLoader` boundary: the package's entries inject them, each loaded version has its own, and their
 * lifecycle hooks run.
 */
import 'reflect-metadata';

import { ProviderScope } from '@frontmcp/di';

import { App, Provider, Tool, ToolContext } from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { EsmModuleLoader, type EsmLoadResult } from '../../esm-loader/esm-module-loader';
import { VersionPoller } from '../../esm-loader/version-poller';
import { VersionResolver } from '../../esm-loader/version-resolver';

const GREETING = Symbol('GREETING');
const events: string[] = [];

function versionOf(version: string, greeting: string, extra: Partial<EsmLoadResult['manifest']> = {}): EsmLoadResult {
  @Provider({ name: `Counter@${version}` })
  class Counter {
    count = 0;
    onBootstrap() {
      events.push(`bootstrap ${version}`);
    }
    onReady() {
      events.push(`ready ${version}`);
    }
    onShutdown() {
      events.push(`shutdown ${version}`);
    }
  }

  @Tool({ name: 'greet', inputSchema: {} })
  class GreetTool extends ToolContext {
    async execute() {
      const counter = this.get(Counter);
      counter.count += 1;
      return `${this.get<string>(GREETING)} #${counter.count}`;
    }
  }

  return {
    manifest: {
      name: '@acme/tools',
      version,
      providers: [{ provide: GREETING, useValue: greeting }, Counter],
      tools: [
        GreetTool,
        {
          name: 'plain_greet',
          execute: async (_input: Record<string, unknown>, context: ToolContext) => context.get<string>(GREETING),
        },
      ],
      ...extra,
    },
    resolvedVersion: version,
    source: 'network',
    loadedAt: Date.now(),
    rawModule: {},
  };
}

/** A tool's answer: a decorated tool's string comes as `{ value }` structured content, a plain tool's as its text. */
const textOf = (result: { content: unknown; structuredContent?: unknown }) =>
  (result.structuredContent as { value?: string } | undefined)?.value ??
  (result.content as Array<{ text: string }>)[0]?.text;

describe('App.esm() providers', () => {
  let server: DirectMcpServer | undefined;
  let load: jest.SpyInstance;

  beforeEach(() => {
    events.length = 0;
    load = jest.spyOn(EsmModuleLoader.prototype, 'load').mockResolvedValue(versionOf('1.0.0', 'hello'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose().catch(() => undefined);
    server = undefined;
  });

  async function createGateway(): Promise<DirectMcpServer> {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme' })],
    });
    return server;
  }

  it("gives the package's entries its providers: one GLOBAL instance per loaded version", async () => {
    const srv = await createGateway();

    expect(textOf(await srv.callTool('acme:greet', {}))).toBe('hello #1');
    expect(textOf(await srv.callTool('acme:greet', {}))).toBe('hello #2');
  });

  it('passes a plain-object tool the call context, whose get() resolves the package providers', async () => {
    const srv = await createGateway();

    expect(textOf(await srv.callTool('acme:plain_greet', {}))).toBe('hello');
  });

  it('builds a CONTEXT-scoped provider for the calls that use it, not at load', async () => {
    let built = 0;
    @Provider({ name: 'RequestStamp', scope: ProviderScope.CONTEXT })
    class RequestStamp {
      readonly id = ++built;
    }
    @Tool({ name: 'stamp', inputSchema: {} })
    class StampTool extends ToolContext {
      async execute() {
        return String(this.get(RequestStamp).id);
      }
    }
    load.mockResolvedValue({
      ...versionOf('1.0.0', 'hello'),
      manifest: { name: '@acme/tools', version: '1.0.0', providers: [RequestStamp], tools: [StampTool] },
    });
    const srv = await createGateway();
    expect(built).toBe(0);

    expect(textOf(await srv.callTool('acme:stamp', {}))).toBe('1');
  });

  it('runs onBootstrap() at load, onReady() once the server is ready, and onShutdown() when it shuts down', async () => {
    await createGateway();
    expect(events).toEqual(['bootstrap 1.0.0', 'ready 1.0.0']);

    await server?.dispose();
    server = undefined;

    expect(events).toEqual(['bootstrap 1.0.0', 'ready 1.0.0', 'shutdown 1.0.0']);
  });

  it("keeps the package's providers out of the other apps", async () => {
    @Tool({ name: 'peek', inputSchema: {} })
    class PeekTool extends ToolContext {
      async execute() {
        return String(this.tryGet(GREETING) ?? 'none');
      }
    }
    @App({ name: 'local', tools: [PeekTool] })
    class LocalApp {}
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [LocalApp, App.esm('@acme/tools@^1.0.0', { namespace: 'acme' })],
    });

    expect(textOf(await server.callTool('peek', {}))).toBe('none');
  });

  it('stops the server when the package exports a provider that is not one', async () => {
    load.mockResolvedValue({
      ...versionOf('1.0.0', 'hello'),
      manifest: { name: '@acme/tools', version: '1.0.0', providers: [{ useValue: 1 }] },
    });

    await expect(createGateway()).rejects.toThrow(/provide/);
  });

  it("stops the server when a provider's factory fails, and shuts down the providers already built", async () => {
    const failing = { provide: Symbol('FAILING'), useFactory: () => Promise.reject(new Error('no database')) };
    const loaded = versionOf('1.0.0', 'hello');
    load.mockResolvedValue({
      ...loaded,
      manifest: { ...loaded.manifest, providers: [...(loaded.manifest.providers ?? []), failing] },
    });

    await expect(createGateway()).rejects.toThrow('no database');
    expect(events).toEqual(['bootstrap 1.0.0', 'shutdown 1.0.0']);
  });
});

describe('App.esm() providers across versions', () => {
  let server: DirectMcpServer | undefined;
  let poller: { poll(): Promise<void> } | undefined;
  let load: jest.SpyInstance;

  beforeEach(() => {
    events.length = 0;
    load = jest.spyOn(EsmModuleLoader.prototype, 'load').mockResolvedValueOnce(versionOf('1.0.0', 'hello'));
    jest.spyOn(VersionPoller.prototype, 'start').mockImplementation(function (this: VersionPoller) {
      poller = this as unknown as { poll(): Promise<void> };
    });
    jest
      .spyOn(VersionResolver.prototype, 'resolve')
      .mockResolvedValue({ resolvedVersion: '1.1.0', availableVersions: ['1.0.0', '1.1.0'] });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose().catch(() => undefined);
    server = undefined;
    poller = undefined;
  });

  async function startPolling(): Promise<{ srv: DirectMcpServer; poll: () => Promise<void> }> {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', autoUpdate: { enabled: true } })],
    });
    const started = poller;
    if (!started) throw new Error('the version poller did not start');
    return { srv: server, poll: () => started.poll() };
  }

  it("builds the new version's providers, runs their onReady(), and keeps the old ones until shutdown", async () => {
    const { srv, poll } = await startPolling();
    expect(textOf(await srv.callTool('acme:greet', {}))).toBe('hello #1');
    load.mockResolvedValueOnce(versionOf('1.1.0', 'hi'));

    await poll();

    expect(textOf(await srv.callTool('acme:greet', {}))).toBe('hi #1');
    expect(events).toEqual(['bootstrap 1.0.0', 'ready 1.0.0', 'bootstrap 1.1.0', 'ready 1.1.0']);

    await server?.dispose();
    server = undefined;
    expect(events.slice(4).sort()).toEqual(['shutdown 1.0.0', 'shutdown 1.1.0']);
  });

  it('keeps the loaded version when the new one cannot build its providers, and shuts those it built down', async () => {
    const { srv, poll } = await startPolling();
    const broken = versionOf('1.1.0', 'hi');
    const failing = { provide: Symbol('FAILING'), useFactory: () => Promise.reject(new Error('no database')) };
    load.mockResolvedValueOnce({
      ...broken,
      manifest: { ...broken.manifest, providers: [...(broken.manifest.providers ?? []), failing] },
    });

    await poll();

    expect(textOf(await srv.callTool('acme:greet', {}))).toBe('hello #1');
    expect(events).toEqual(['bootstrap 1.0.0', 'ready 1.0.0', 'bootstrap 1.1.0', 'shutdown 1.1.0']);
  });
});
