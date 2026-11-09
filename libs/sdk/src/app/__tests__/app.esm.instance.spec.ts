/**
 * `App.esm()` through a real scope, with the package load mocked at the `EsmModuleLoader` boundary:
 * `filter` picks the entries by their package names and `importMap` reaches the loader (#766).
 */
import 'reflect-metadata';

import {
  App,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Tool,
  ToolContext,
  type EsmAppOptions,
  type LogRecord,
} from '../../common';
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

  it('warns that the jobs and workflows of the package are not loaded', async () => {
    load.mockResolvedValue({ ...loadResult, manifest: { ...loadResult.manifest, jobs: [{}], workflows: [{}] } });
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme' })],
      logging: { transports: [WarningCapture] },
    });

    expect(warnings).toContain(
      "ESM app acme: App.esm() loads only tools, resources, prompts, agents, skills and providers; the package's jobs, workflows are not loaded",
    );
  });

  it('warns about the kinds it skips before an entry fails to build', async () => {
    warnings.length = 0;
    const manifest = { ...loadResult.manifest, jobs: [{}] };
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
      "ESM app acme: App.esm() loads only tools, resources, prompts, agents, skills and providers; the package's jobs are not loaded",
    );
  });

  it("merges the app's loader with the server's, so the server's token reaches the app's registry", async () => {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      loader: { url: 'https://esm.acme.example', token: 'server-token' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', loader: { registryUrl: 'https://npm.acme.example' } })],
    });

    const loader = load.mock.contexts[0] as { registryAuth: unknown; esmBaseUrl: string };
    expect(loader.registryAuth).toEqual({ registryUrl: 'https://npm.acme.example', token: 'server-token' });
    expect(loader.esmBaseUrl).toBe('https://esm.acme.example');
  });

  it('accepts a cacheTTL of 0', async () => {
    const srv = await createGateway({ cacheTTL: 0 });

    expect((await srv.listTools()).tools.map((tool) => tool.name)).toContain('acme:echo');
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

  it('keeps the loaded version when the new one declares metadata no installed plugin enforces', async () => {
    @Plugin({ name: 'esm-approval', enforcesMetadata: ['approval'] })
    class ApprovalPlugin {
      @(FlowHooksOf('tools:call-tool').Will('execute'))
      gate() {
        // only declares the key
      }
    }
    @Tool({ name: 'payout', inputSchema: {}, ...({ approval: true } as Record<string, unknown>) })
    class PayoutTool extends ToolContext {
      async execute() {
        return 'paid';
      }
    }
    expect(ApprovalPlugin).toBeDefined();
    const { srv, poll } = await startPolling();
    load.mockResolvedValueOnce({
      ...versionOf('1.1.0', 'echo'),
      manifest: { name: '@acme/tools', version: '1.1.0', tools: [PayoutTool] },
    });

    await poll();

    expect(await toolNames(srv)).toEqual(['acme:echo']);
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

describe('App.esm() plain-object tools', () => {
  const statusOf = async (input: Record<string, unknown>) => ({ service: input['service'], up: true });
  let server: DirectMcpServer | undefined;

  beforeEach(() => {
    jest.spyOn(EsmModuleLoader.prototype, 'load').mockResolvedValue({
      ...loadResult,
      manifest: {
        name: '@acme/tools',
        version: '1.0.0',
        tools: [
          {
            name: 'get_status',
            inputSchema: {
              type: 'object',
              properties: { service: { type: 'string' } },
              required: ['service'],
            },
            execute: statusOf,
          },
          { name: 'count', execute: async () => 3 },
          { name: 'hello', execute: async () => 'hello' },
        ],
      },
    });
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

  it('sends an object answer as JSON, with its structuredContent', async () => {
    const srv = await createGateway();

    const result = await srv.callTool('acme:get_status', { service: 'api' });

    expect(result.content).toEqual([{ type: 'text', text: '{"service":"api","up":true}' }]);
    expect(result.structuredContent).toEqual({ service: 'api', up: true });
  });

  it('sends a string or a number answer as its text', async () => {
    const srv = await createGateway();

    expect((await srv.callTool('acme:hello', {})).content).toEqual([{ type: 'text', text: 'hello' }]);
    expect((await srv.callTool('acme:count', {})).content).toEqual([{ type: 'text', text: '3' }]);
  });

  it('checks the arguments against the JSON Schema inputSchema', async () => {
    const srv = await createGateway();

    await expect(srv.callTool('acme:get_status', { service: 42 })).rejects.toThrow('Invalid tool input');
  });
});
