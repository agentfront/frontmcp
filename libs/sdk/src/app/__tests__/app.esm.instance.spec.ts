/**
 * `App.esm()` through a real scope, with the package load mocked at the `EsmModuleLoader` boundary:
 * `filter` picks the entries by their package names and `importMap` reaches the loader (#766).
 */
import 'reflect-metadata';

import { App, type EsmAppOptions } from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { EsmModuleLoader, type EsmLoadResult } from '../../esm-loader/esm-module-loader';

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
