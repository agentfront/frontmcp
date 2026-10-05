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
