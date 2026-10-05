/** Per-entry `.esm()` entries load at startup; the network is mocked at the `EsmModuleLoader` boundary. */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  Agent,
  AgentContext,
  App,
  Channel,
  ChannelContext,
  FlowHooksOf,
  LogLevel,
  Plugin,
  Prompt,
  Resource,
  Tool,
  ToolContext,
  type ChannelNotification,
  type FlowCtxOf,
  type PromptType,
  type ResourceType,
  type ToolType,
} from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { ExternalEntryLoadError, ExternalEntryNotFoundError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { registryAuthOf } from '../esm-entries';
import { type FrontMcpPackageManifest } from '../esm-manifest';
import { EsmModuleLoader, type EsmLoadResult } from '../esm-module-loader';
import { type ParsedPackageSpecifier } from '../package-specifier';

const PACKAGE = '@acme/tools@^1.0.0';

@Tool({ name: 'echo', description: 'Echoes the message', inputSchema: { message: z.string() } })
class EchoTool extends ToolContext {
  async execute({ message }: { message: string }) {
    return { echoed: message };
  }
}

const acmeTools: FrontMcpPackageManifest = {
  name: '@acme/tools',
  version: '1.0.0',
  tools: [
    EchoTool,
    {
      name: 'reverse',
      description: 'Reverses text',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (input: { text: string }) => ({
        content: [{ type: 'text', text: input.text.split('').reverse().join('') }],
      }),
    },
  ],
  resources: [
    {
      name: 'status',
      uri: 'acme://status',
      mimeType: 'text/plain',
      read: async (uri: string) => ({ contents: [{ uri, text: 'ok' }] }),
    },
  ],
  prompts: [
    {
      name: 'greet',
      arguments: [{ name: 'name', required: true }],
      execute: async (args: Record<string, string>) => ({
        messages: [{ role: 'user', content: { type: 'text', text: `Hello, ${args['name']}` } }],
      }),
    },
  ],
};

const toolRuns: string[] = [];
const ToolHook = FlowHooksOf('tools:call-tool');

@Plugin({ name: 'audit' })
class AuditPlugin {
  @ToolHook.Will('execute')
  audit(ctx: FlowCtxOf<'tools:call-tool'>) {
    toolRuns.push(`${ctx.state.tool?.name}`);
  }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string | undefined {
  return result.content[0]?.text;
}

describe('per-entry .esm() loading', () => {
  let server: DirectMcpServer | undefined;
  let load: jest.SpyInstance<Promise<EsmLoadResult>, [ParsedPackageSpecifier]>;

  beforeEach(() => {
    toolRuns.length = 0;
    load = jest.spyOn(EsmModuleLoader.prototype, 'load').mockImplementation(async (specifier) => {
      if (specifier.fullName !== '@acme/tools') throw new Error(`esm.sh returned 404 for "${specifier.fullName}"`);
      return { manifest: acmeTools, resolvedVersion: '1.0.0', source: 'cache', loadedAt: 0, rawModule: {} };
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose();
    server = undefined;
  });

  async function start(entries: { tools?: ToolType[]; resources?: ResourceType[]; prompts?: PromptType[] }) {
    @App({ name: 'catalog', ...entries })
    class CatalogApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-entries', version: '1.0.0' },
      apps: [CatalogApp],
      logging: { level: LogLevel.Off },
    });
    return server;
  }

  it('registers a plain-object tool under its own name and runs it', async () => {
    const srv = await start({ tools: [Tool.esm(PACKAGE, 'reverse')] });

    expect((await srv.listTools()).tools.map((tool) => tool.name)).toEqual(['reverse']);
    expect(textOf(await srv.callTool('reverse', { text: 'abc' }))).toBe('cba');
  });

  it('registers a decorated tool class through the standard tool path', async () => {
    const srv = await start({ tools: [Tool.esm(PACKAGE, 'echo')] });

    const result = await srv.callTool('echo', { message: 'hi' });
    expect(result.structuredContent).toEqual({ echoed: 'hi' });
  });

  it('registers a resource and a prompt from the package', async () => {
    const srv = await start({ resources: [Resource.esm(PACKAGE, 'status')], prompts: [Prompt.esm(PACKAGE, 'greet')] });

    const read = await srv.readResource('acme://status');
    expect(read.contents[0]).toEqual(expect.objectContaining({ text: 'ok' }));
    const prompt = await srv.getPrompt('greet', { name: 'Ada' });
    expect(prompt.messages[0]?.content).toEqual({ type: 'text', text: 'Hello, Ada' });
  });

  it('registers every tool of the package for a package specifier string', async () => {
    const srv = await start({ tools: [PACKAGE] });

    expect((await srv.listTools()).tools.map((tool) => tool.name).sort()).toEqual(['echo', 'reverse']);
  });

  it('loads a package once per server, however many entries name it', async () => {
    await start({
      tools: [Tool.esm(PACKAGE, 'echo'), Tool.esm(PACKAGE, 'reverse')],
      resources: [Resource.esm(PACKAGE, 'status')],
      prompts: [Prompt.esm(PACKAGE, 'greet')],
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ fullName: '@acme/tools', range: '^1.0.0' }));
  });

  it('loads the package again for an entry with another loader', async () => {
    await start({
      tools: [
        Tool.esm(PACKAGE, 'echo'),
        Tool.esm(PACKAGE, 'reverse', {
          loader: { url: 'https://registry.internal.example', tokenEnvVar: 'INTERNAL_REGISTRY_TOKEN' },
        }),
      ],
    });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads the package again for another server', async () => {
    await start({ tools: [Tool.esm(PACKAGE, 'echo')] });
    await server?.dispose();
    await start({ tools: [Tool.esm(PACKAGE, 'echo')] });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('applies options.metadata over the loaded metadata', async () => {
    const srv = await start({
      tools: [
        Tool.esm(PACKAGE, 'reverse', { metadata: { name: 'flip', description: 'Flips text' } }),
        Tool.esm(PACKAGE, 'echo', { metadata: { name: 'say' } }),
      ],
    });

    const tools = (await srv.listTools()).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual(['flip', 'say']);
    expect(tools.find((tool) => tool.name === 'flip')?.description).toBe('Flips text');
    expect(textOf(await srv.callTool('flip', { text: 'abc' }))).toBe('cba');
  });

  it("runs the owning app's hooks when the tool is called", async () => {
    @App({ name: 'audited', tools: [Tool.esm(PACKAGE, 'reverse')], plugins: [AuditPlugin] })
    class AuditedApp {}
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-entries', version: '1.0.0' },
      apps: [AuditedApp],
      logging: { level: LogLevel.Off },
    });

    await server.callTool('reverse', { text: 'abc' });
    expect(toolRuns).toEqual(['reverse']);
  });

  it("loads an entry in an agent's tools", async () => {
    const flipAdapter = {
      completion: async (prompt: { messages: Array<{ role: string; content: string | null }> }) => {
        const last = prompt.messages[prompt.messages.length - 1];
        if (last?.role === 'tool') return { content: last.content, finishReason: 'stop' as const };
        return {
          content: null,
          finishReason: 'tool_calls' as const,
          toolCalls: [{ id: 'call-1', name: 'reverse', arguments: { text: 'abc' } }],
        };
      },
    };
    @Agent({ name: 'flipper', inputSchema: {}, llm: { adapter: flipAdapter }, tools: [Tool.esm(PACKAGE, 'reverse')] })
    class FlipperAgent extends AgentContext {}
    @App({ name: 'agents', agents: [FlipperAgent] })
    class AgentsApp {}
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-entries', version: '1.0.0' },
      apps: [AgentsApp],
      logging: { level: LogLevel.Off },
    });

    expect(JSON.stringify(await server.callTool('invoke_flipper', {}))).toContain('cba');
  });

  it("fails startup when a loaded tool in an agent's tools declares authorities that nothing enforces", async () => {
    @Tool({ name: 'purge', inputSchema: {}, authorities: { roles: { any: ['admin'] } } })
    class PurgeTool extends ToolContext {
      async execute() {
        return 'purged';
      }
    }
    load.mockResolvedValue({
      manifest: { name: '@acme/admin', version: '1.0.0', tools: [PurgeTool] },
      resolvedVersion: '1.0.0',
      source: 'cache',
      loadedAt: 0,
      rawModule: {},
    });
    const idleAdapter = { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) };
    @Agent({
      name: 'janitor',
      inputSchema: {},
      llm: { adapter: idleAdapter },
      tools: [Tool.esm('@acme/admin@^1.0.0', 'purge')],
    })
    class JanitorAgent extends AgentContext {}
    @App({ name: 'agents', agents: [JanitorAgent] })
    class AgentsApp {}

    const startup = FrontMcpInstance.createDirect({
      info: { name: 'esm-entries', version: '1.0.0' },
      apps: [AgentsApp],
      logging: { level: LogLevel.Off },
    });

    await expect(startup).rejects.toThrow('Tool "janitor:purge" declare');
  });

  it("loads an entry in a channel's tools", async () => {
    @Channel({
      name: 'support',
      source: { type: 'app-event', event: 'support' },
      tools: [Tool.esm(PACKAGE, 'reverse')],
    })
    class SupportChannel extends ChannelContext {
      async onEvent(payload: unknown): Promise<ChannelNotification> {
        return { content: String(payload) };
      }
    }
    @App({ name: 'support', channels: [SupportChannel] })
    class SupportApp {}
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-entries', version: '1.0.0' },
      apps: [SupportApp],
      channels: { enabled: true },
      logging: { level: LogLevel.Off },
    });

    expect(textOf(await server.callTool('reverse', { text: 'ab' }))).toBe('ba');
  });

  it('loads server-level entries of @FrontMcp too', async () => {
    @App({ name: 'empty' })
    class EmptyApp {}
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-entries', version: '1.0.0' },
      apps: [EmptyApp],
      tools: [Tool.esm(PACKAGE, 'reverse')],
      logging: { level: LogLevel.Off },
    });

    expect(textOf(await server.callTool('reverse', { text: 'ab' }))).toBe('ba');
  });

  it('fails startup when the package has no entry with the target name', async () => {
    const startup = start({ tools: [Tool.esm(PACKAGE, 'missing')] });

    await expect(startup).rejects.toThrow(ExternalEntryNotFoundError);
    await expect(startup).rejects.toThrow(
      'Tool "missing" was not found in @acme/tools@^1.0.0 (tools there: echo, reverse)',
    );
  });

  it('fails startup when the package does not load', async () => {
    const startup = start({ prompts: [Prompt.esm('@acme/absent@^2.0.0', 'greet')] });

    await expect(startup).rejects.toThrow(ExternalEntryLoadError);
    await expect(startup).rejects.toThrow(
      'Failed to load prompt "greet" from @acme/absent@^2.0.0: esm.sh returned 404 for "@acme/absent"',
    );
  });
});

describe('registryAuthOf()', () => {
  it('resolves versions from the registry URL, else from the loader URL', () => {
    expect(registryAuthOf({ url: 'https://esm.internal', token: 't' })).toEqual({
      registryUrl: 'https://esm.internal',
      token: 't',
      tokenEnvVar: undefined,
    });
    expect(registryAuthOf({ url: 'https://esm.internal', registryUrl: 'https://npm.internal' })?.registryUrl).toBe(
      'https://npm.internal',
    );
    expect(registryAuthOf(undefined)).toBeUndefined();
  });
});
