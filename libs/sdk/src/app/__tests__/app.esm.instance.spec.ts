/**
 * `App.esm()` through a real scope, with the package load mocked at the `EsmModuleLoader` boundary:
 * `filter` picks the entries by their package names and `importMap` reaches the loader (#766).
 */
import 'reflect-metadata';

import { App, LogLevel, LogTransport, LogTransportInterface, type EsmAppOptions, type LogRecord } from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { EsmModuleLoader, type EsmLoadResult } from '../../esm-loader/esm-module-loader';
import { VersionPoller } from '../../esm-loader/version-poller';
import { VersionResolver } from '../../esm-loader/version-resolver';

const loadResult: EsmLoadResult = {
  manifest: {
    name: '@acme/tools',
    version: '1.0.0',
    tools: [
      { name: 'echo', execute: async () => ({ content: [] }) },
      { name: 'drop-tables', execute: async () => ({ content: [] }) },
    ],
    prompts: [{ name: 'greeting', execute: async () => ({ messages: [] }) }],
    resources: [{ name: 'status', uri: 'status://acme', read: async () => ({ contents: [] }) }],
  },
  resolvedVersion: '1.0.0',
  source: 'network',
  loadedAt: Date.now(),
  rawModule: {},
};

const warnings: string[] = [];

@LogTransport({ name: 'EsmWarningCapture', description: 'Keeps the warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

describe('App.esm()', () => {
  let server: DirectMcpServer | undefined;
  let load: jest.SpyInstance;

  beforeEach(() => {
    load = jest.spyOn(EsmModuleLoader.prototype, 'load').mockResolvedValue(loadResult);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose().catch(() => undefined);
    server = undefined;
  });

  async function createGateway(options: EsmAppOptions): Promise<DirectMcpServer> {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', ...options })],
    });
    return server;
  }

  it('registers only the entries the filter lets through, matched by their package names', async () => {
    const srv = await createGateway({ filter: { exclude: { tools: ['drop-*'], prompts: ['greeting'] } } });

    expect((await srv.listTools()).tools.map((tool) => tool.name)).toEqual(['acme:echo']);
    expect((await srv.listPrompts()).prompts).toEqual([]);
    expect((await srv.listResources()).resources.map((resource) => resource.uri)).toEqual(['status://acme']);
  });

  it('warns that the skills, agents, jobs, workflows and providers of the package are not loaded', async () => {
    load.mockResolvedValue({ ...loadResult, manifest: { ...loadResult.manifest, skills: [{}], providers: [{}] } });
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme' })],
      logging: { transports: [WarningCapture] },
    });

    expect(warnings).toContain(
      "ESM app acme: App.esm() loads only tools, resources and prompts; the package's skills, providers are not loaded",
    );
  });

  it('warns about the kinds it skips before an entry fails to build', async () => {
    warnings.length = 0;
    const manifest = { ...loadResult.manifest, providers: [{}] };
    Object.defineProperty(manifest, 'tools', {
      get: () => {
        throw new Error('tool needs the package provider');
      },
    });
    load.mockResolvedValue({ ...loadResult, manifest });
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');

    await expect(
      FrontMcpInstance.createDirect({
        info: { name: 'esm-gateway', version: '1.0.0' },
        apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme' })],
        logging: { transports: [WarningCapture] },
      }),
    ).rejects.toThrow('tool needs the package provider');
    expect(warnings).toContain(
      "ESM app acme: App.esm() loads only tools, resources and prompts; the package's providers are not loaded",
    );
  });

  it('hands the import map to the loader', async () => {
    await createGateway({ importMap: { zod: 'https://cdn.example.com/zod.mjs' } });

    const loader = load.mock.contexts[0] as { importMap: Record<string, string> };
    expect(loader.importMap).toEqual({ zod: 'https://cdn.example.com/zod.mjs' });
  });
});

describe('App.esm() of one package more than once', () => {
  const echoTool = { name: 'echo', execute: async () => ({ content: [] }) };
  let server: DirectMcpServer | undefined;

  beforeEach(() => {
    let delayMs = 50;
    jest.spyOn(EsmModuleLoader.prototype, 'load').mockImplementation(async () => {
      delayMs -= 10;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { ...loadResult, manifest: { name: '@acme/deploy-tools', version: '1.0.0', tools: [echoTool] } };
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose().catch(() => undefined);
    server = undefined;
  });

  async function createGateway(...apps: ReturnType<typeof App.esm>[]): Promise<DirectMcpServer> {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({ info: { name: 'esm-gateway', version: '1.0.0' }, apps });
    return server;
  }

  it('gives each unnamed app the id of its namespace, so every one of their tools is listed', async () => {
    const namespaces = ['stable', 'pinned', 'beta', 'latest', 'canary'];
    const srv = await createGateway(
      ...namespaces.map((namespace) => App.esm(`@acme/deploy-tools@${namespace}`, { namespace })),
    );

    expect((await srv.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
      namespaces.map((namespace) => `${namespace}:echo`).sort(),
    );
  });

  it('keeps the id of a named app', () => {
    expect(App.esm('@acme/deploy-tools@1.0.0', { name: 'pinned', namespace: 'old' }).id).toBeUndefined();
    expect(App.esm('@acme/deploy-tools@1.0.0', { namespace: 'old' }).id).toBe('old');
  });

  it('stops the server when two apps of the package have neither a name nor a namespace of their own', async () => {
    await expect(
      createGateway(App.esm('@acme/deploy-tools@^1.0.0'), App.esm('@acme/deploy-tools@next')),
    ).rejects.toThrow(/apps share the id "acme-deploy-tools".*name/);
  });
});

describe('App.esm() with autoUpdate', () => {
  const versionOf = (version: string, toolName: string): EsmLoadResult => ({
    ...loadResult,
    resolvedVersion: version,
    manifest: { name: '@acme/tools', version, tools: [{ name: toolName, execute: async () => ({ content: [] }) }] },
  });
  const brokenVersion = (version: string): EsmLoadResult => {
    const manifest = { name: '@acme/tools', version };
    Object.defineProperty(manifest, 'tools', {
      get: () => {
        throw new Error('the new version does not build');
      },
    });
    return { ...loadResult, resolvedVersion: version, manifest: manifest as EsmLoadResult['manifest'] };
  };

  let server: DirectMcpServer | undefined;
  let poller: { poll(): Promise<void> } | undefined;
  let load: jest.SpyInstance;

  beforeEach(() => {
    load = jest.spyOn(EsmModuleLoader.prototype, 'load').mockResolvedValueOnce(versionOf('1.0.0', 'echo'));
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

  const toolNames = async (srv: DirectMcpServer) => (await srv.listTools()).tools.map((tool) => tool.name);

  it('keeps the loaded version when the new one fails to register, and tries it again at the next poll', async () => {
    const { srv, poll } = await startPolling();
    load.mockResolvedValueOnce(brokenVersion('1.1.0'));

    await poll();
    expect(await toolNames(srv)).toEqual(['acme:echo']);

    load.mockResolvedValueOnce(versionOf('1.1.0', 'echo_v2'));
    await poll();
    expect(load).toHaveBeenCalledTimes(3);
    expect(await toolNames(srv)).toEqual(['acme:echo_v2']);
  });

  it('swaps the entries once per new version', async () => {
    const { srv, poll } = await startPolling();
    load.mockResolvedValueOnce(versionOf('1.1.0', 'echo_v2'));

    await poll();
    await poll();

    expect(load).toHaveBeenCalledTimes(2);
    expect(await toolNames(srv)).toEqual(['acme:echo_v2']);
  });
});
