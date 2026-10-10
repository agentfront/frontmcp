/**
 * An agent's model reads the resources and prompts the agent declares (#699): it is offered
 * `list_resources` / `read_resource` when the agent declares resources, and `list_prompts` /
 * `get_prompt` when it declares prompts. They run through the flows of the agent's private scope, so
 * the hooks, authorities and errors of a client's call apply.
 */
import 'reflect-metadata';

import { inspect } from 'node:util';

import { z } from '@frontmcp/lazy-zod';
import { type GetPromptResult } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  Agent,
  AgentContext,
  App,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type AgentLlmAdapter,
  type AgentToolDefinition,
  type FlowCtxOf,
  type LogRecord,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { AgentConfigurationError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  AGENT_BUILTIN_TOOL_DEFINITIONS,
  describePromptListing,
  promptResultToText,
  resourceContentsToText,
} from '../agent-builtin-tools';

const ReadResourceHook = FlowHooksOf('resources:read-resource');
const GetPromptHook = FlowHooksOf('prompts:get-prompt');

const offered: Record<string, AgentToolDefinition[]> = {};
const runs: string[] = [];
const logLines: string[] = [];

@LogTransport({ name: 'AgentReadsCapture', description: 'Captures log lines for assertions' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    logLines.push(
      [record.message, ...record.args].map((value) => (typeof value === 'string' ? value : inspect(value))).join(' '),
    );
  }
}

/**
 * An LLM that calls the tool its input names (`{ tool, args }`), then answers with what the tool
 * returned: `{ "read": "<the tool message the model read>" }`.
 */
function scriptedModel(label: string): AgentLlmAdapter {
  return {
    completion: async (prompt, tools) => {
      offered[label] = tools ?? [];
      const last = prompt.messages[prompt.messages.length - 1];
      if (last?.role === 'tool') return { content: JSON.stringify({ read: last.content }), finishReason: 'stop' };
      const request = JSON.parse(prompt.messages[0]?.content ?? '{}') as {
        tool: string;
        args?: Record<string, unknown>;
      };
      return {
        content: null,
        finishReason: 'tool_calls',
        toolCalls: [{ id: `${label}-call`, name: request.tool, arguments: request.args ?? {} }],
      };
    },
  };
}

const inputSchema = { tool: z.string(), args: z.record(z.string(), z.unknown()).optional() };

// ---------------------------------------------------------------- resources and prompts

@Resource({ name: 'shelf', uri: 'library://shelf', mimeType: 'text/plain', description: 'What is on the shelf' })
class ShelfResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'three books' }] };
  }
}

@Resource({ name: 'cover', uri: 'library://cover', mimeType: 'image/png' })
class CoverResource extends ResourceContext {
  async execute(uri: string) {
    // 6 bytes
    return { contents: [{ uri, mimeType: 'image/png', blob: Buffer.from('PNG123').toString('base64') }] };
  }
}

@ResourceTemplate({ name: 'book', uriTemplate: 'library://books/{id}', mimeType: 'text/plain' })
class BookResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, { id }: { id: string }) {
    return { contents: [{ uri, text: `Book ${id}` }] };
  }
}

/** Offered to clients only: the agent's model must not see it. */
@Resource({ name: 'ledger', uri: 'library://ledger', availableWhen: { surface: ['mcp'] } })
class LedgerResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'secret ledger' }] };
  }
}

@Prompt({
  name: 'greeting',
  description: 'Greets a visitor',
  arguments: [{ name: 'visitor', description: 'Who visits', required: true }],
})
class GreetingPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return {
      description: 'A greeting',
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text: `Welcome, ${args['visitor']}` } },
        { role: 'assistant' as const, content: { type: 'text' as const, text: 'How can I help?' } },
      ],
    };
  }
}

/** Installed on the agent: its hooks run in the agent's private scope. */
@Plugin({ name: 'reading-audit' })
class ReadingAuditPlugin {
  @ReadResourceHook.Will('execute')
  onRead(ctx: FlowCtxOf<'resources:read-resource'>) {
    runs.push(`read:${ctx.state.resource?.name}`);
  }

  @GetPromptHook.Will('execute')
  onPrompt(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    runs.push(`prompt:${ctx.state.prompt?.name}`);
  }
}

@Tool({ name: 'count_books', inputSchema: {} })
class CountBooksTool extends ToolContext {
  async execute() {
    return { books: 3 };
  }
}

const executedByOverride: string[] = [];

@Agent({
  name: 'librarian',
  inputSchema,
  llm: { adapter: scriptedModel('librarian') },
  tools: [CountBooksTool],
  resources: [ShelfResource, CoverResource, BookResource, LedgerResource],
  prompts: [GreetingPrompt],
  plugins: [ReadingAuditPlugin],
  // Only the shelf is shared with clients: the model reads every one of them
  exports: { resources: [ShelfResource] },
})
class LibrarianAgent extends AgentContext {
  protected override async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    executedByOverride.push(name);
    return super.executeTool(name, args);
  }
}

@Agent({
  name: 'archivist',
  inputSchema,
  llm: { adapter: scriptedModel('archivist') },
  resources: [ShelfResource],
  plugins: [ReadingAuditPlugin],
  execution: { useToolFlow: false },
})
class ArchivistAgent extends AgentContext {}

@Agent({ name: 'herald', inputSchema, llm: { adapter: scriptedModel('herald') }, prompts: [GreetingPrompt] })
class HeraldAgent extends AgentContext {}

@Agent({ name: 'counter', inputSchema, llm: { adapter: scriptedModel('counter') }, tools: [CountBooksTool] })
class CounterAgent extends AgentContext {}

@Agent({ name: 'bare', inputSchema, llm: { adapter: scriptedModel('bare') } })
class BareAgent extends AgentContext {}

@Agent({
  name: 'clerk',
  inputSchema,
  llm: { adapter: scriptedModel('clerk') },
  resources: [LedgerResource],
})
class ClerkAgent extends AgentContext {}

/** A tool by a built-in's name, on an agent that declares no prompts: nothing clashes. */
@Tool({ name: 'get_prompt', inputSchema: {} })
class GetPromptTool extends ToolContext {
  async execute() {
    return { own: 'get_prompt' };
  }
}

@Agent({ name: 'scribe', inputSchema, llm: { adapter: scriptedModel('scribe') }, tools: [GetPromptTool] })
class ScribeAgent extends AgentContext {}

/** The app's tool by a built-in's name: the agent's built-in wins. */
@Tool({ name: 'list_resources', inputSchema: {} })
class AppListResourcesTool extends ToolContext {
  async execute() {
    return { app: 'list_resources' };
  }
}

@Agent({
  name: 'heir',
  inputSchema,
  llm: { adapter: scriptedModel('heir') },
  resources: [ShelfResource],
  execution: { inheritParentTools: true },
})
class HeirAgent extends AgentContext {}

/** A nested agent exports its shelf to its parent agent, whose model reads it. */
@Agent({
  name: 'stacks',
  inputSchema: {},
  llm: { adapter: scriptedModel('stacks') },
  resources: [ShelfResource],
  exports: { resources: '*' },
})
class StacksAgent extends AgentContext {}

@Agent({ name: 'curator', inputSchema, llm: { adapter: scriptedModel('curator') }, agents: [StacksAgent] })
class CuratorAgent extends AgentContext {}

@App({
  id: 'library',
  name: 'Library',
  tools: [AppListResourcesTool],
  agents: [
    LibrarianAgent,
    ArchivistAgent,
    HeraldAgent,
    CounterAgent,
    BareAgent,
    ClerkAgent,
    ScribeAgent,
    HeirAgent,
    CuratorAgent,
  ],
})
class LibraryApp {}

/** What the agent's model read for the tool call its input names. */
async function readThrough(
  server: DirectMcpServer,
  agent: string,
  tool: string,
  args?: Record<string, unknown>,
): Promise<string> {
  const result = await server.callTool(`invoke_${agent}`, { tool, ...(args && { args }) });
  expect(result.isError).toBeFalsy();
  return (result.structuredContent as { read: string }).read;
}

const offeredNames = (label: string) => (offered[label] ?? []).map((tool) => tool.name).sort();

describe("an agent's model reading the agent's resources and prompts", () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'agent-reads', version: '1.0.0' },
      apps: [LibraryApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
  });

  describe('the tools the model is offered', () => {
    it('offers the resource and prompt tools to an agent that declares both, besides its own tools', async () => {
      await readThrough(server, 'librarian', 'count_books');

      expect(offeredNames('librarian')).toEqual([
        'count_books',
        'get_prompt',
        'list_prompts',
        'list_resources',
        'read_resource',
      ]);
      const definitions = Object.fromEntries((offered['librarian'] ?? []).map((tool) => [tool.name, tool]));
      expect(definitions['read_resource']).toEqual(AGENT_BUILTIN_TOOL_DEFINITIONS.read_resource);
      expect(definitions['read_resource']?.parameters).toMatchObject({ required: ['uri'] });
      expect(definitions['get_prompt']?.parameters).toMatchObject({ required: ['name'] });
    });

    it('offers only the resource tools to an agent that declares only resources', async () => {
      await readThrough(server, 'archivist', 'list_resources');

      expect(offeredNames('archivist')).toEqual(['list_resources', 'read_resource']);
    });

    it('offers only the prompt tools to an agent that declares only prompts', async () => {
      await readThrough(server, 'herald', 'list_prompts');

      expect(offeredNames('herald')).toEqual(['get_prompt', 'list_prompts']);
    });

    it('adds no tool to an agent that declares neither', async () => {
      await readThrough(server, 'counter', 'count_books');
      await server.callTool('invoke_bare', { tool: 'count_books' });

      expect(offeredNames('counter')).toEqual(['count_books']);
      expect(offeredNames('bare')).toEqual([]);
    });

    it('does not count resources offered to clients only', async () => {
      await server.callTool('invoke_clerk', { tool: 'list_resources' });

      expect(offeredNames('clerk')).toEqual([]);
    });

    it("leaves a tool by a built-in's name to the agent when it declares nothing that tool would read", async () => {
      const read = await readThrough(server, 'scribe', 'get_prompt');

      expect(offeredNames('scribe')).toEqual(['get_prompt']);
      expect(JSON.parse(read)).toEqual({ own: 'get_prompt' });
    });

    it("offers the built-in over a tool of the agent's scope by the same name", async () => {
      const read = await readThrough(server, 'heir', 'list_resources');

      expect(offered['heir']?.filter((tool) => tool.name === 'list_resources')).toHaveLength(1);
      expect(JSON.parse(read)).toEqual({
        resources: [
          { uri: 'library://shelf', name: 'shelf', description: 'What is on the shelf', mimeType: 'text/plain' },
        ],
        resourceTemplates: [],
      });
    });

    it('logs no startup warning about resources or prompts nothing reads', () => {
      expect(logLines.filter((line) => line.includes('nothing reads'))).toEqual([]);
    });
  });

  describe('list_resources and read_resource', () => {
    it('lists the resources and resource templates the model can read, exported or not', async () => {
      const read = await readThrough(server, 'librarian', 'list_resources');

      expect(JSON.parse(read)).toEqual({
        resources: [
          { uri: 'library://shelf', name: 'shelf', description: 'What is on the shelf', mimeType: 'text/plain' },
          { uri: 'library://cover', name: 'cover', mimeType: 'image/png' },
        ],
        resourceTemplates: [{ uriTemplate: 'library://books/{id}', name: 'book', mimeType: 'text/plain' }],
      });
    });

    it("reads an unexported resource's text as it is", async () => {
      // The cover and the books are not exported, the shelf is: the model reads them all
      expect(await readThrough(server, 'librarian', 'read_resource', { uri: 'library://shelf' })).toBe('three books');
      expect(await readThrough(server, 'librarian', 'read_resource', { uri: 'library://books/42' })).toBe('Book 42');
    });

    it('describes binary content instead of sending it', async () => {
      const read = await readThrough(server, 'librarian', 'read_resource', { uri: 'library://cover' });

      expect(read).toBe('[binary content omitted: library://cover (image/png, 6 bytes)]');
    });

    it("runs the read through the agent scope's resources:read-resource flow and its hooks", async () => {
      await readThrough(server, 'librarian', 'read_resource', { uri: 'library://shelf' });

      expect(runs).toEqual(['read:shelf']);
    });

    it('runs the read through the flow when the agent runs its tools directly (useToolFlow: false)', async () => {
      expect(await readThrough(server, 'archivist', 'read_resource', { uri: 'library://shelf' })).toBe('three books');
      expect(runs).toEqual(['read:shelf']);
    });

    it('answers an unknown URI as the tool error the model reads', async () => {
      const read = await readThrough(server, 'librarian', 'read_resource', { uri: 'library://missing' });

      expect(JSON.parse(read)).toEqual({ error: 'Resource not found: library://missing' });
      expect(runs).toEqual([]);
    });

    it('answers a resource offered to clients only like an unknown URI', async () => {
      const read = await readThrough(server, 'librarian', 'read_resource', { uri: 'library://ledger' });

      expect(JSON.parse(read)).toEqual({ error: 'Resource not found: library://ledger' });
    });

    it('answers a call without a URI as the tool error the model reads', async () => {
      const read = await readThrough(server, 'librarian', 'read_resource', {});

      expect(JSON.parse(read).error).toMatch(/^Invalid arguments for read_resource: uri: /);
    });

    it("reads a resource a nested agent exports to the agent's scope", async () => {
      expect(await readThrough(server, 'curator', 'read_resource', { uri: 'library://shelf' })).toBe('three books');
      expect(offeredNames('curator')).toEqual(['invoke_stacks', 'list_resources', 'read_resource']);
    });

    it("goes through the agent's executeTool() override", async () => {
      executedByOverride.length = 0;
      await readThrough(server, 'librarian', 'read_resource', { uri: 'library://shelf' });

      expect(executedByOverride).toEqual(['read_resource']);
    });
  });

  describe('list_prompts and get_prompt', () => {
    it('lists the prompts with their arguments', async () => {
      const read = await readThrough(server, 'librarian', 'list_prompts');

      expect(JSON.parse(read)).toEqual({
        prompts: [
          {
            name: 'greeting',
            description: 'Greets a visitor',
            arguments: [{ name: 'visitor', description: 'Who visits', required: true }],
          },
        ],
      });
    });

    it('gets an unexported prompt as text, through the prompts:get-prompt flow and its hooks', async () => {
      const read = await readThrough(server, 'librarian', 'get_prompt', {
        name: 'greeting',
        arguments: { visitor: 'Ada' },
      });

      expect(read).toBe('A greeting\n\n[user]\nWelcome, Ada\n\n[assistant]\nHow can I help?');
      expect(runs).toEqual(['prompt:greeting']);
    });

    it('passes a number or boolean argument as its text', async () => {
      const read = await readThrough(server, 'librarian', 'get_prompt', {
        name: 'greeting',
        arguments: { visitor: 7 },
      });

      expect(read).toContain('Welcome, 7');
    });

    it('answers an unknown prompt as the tool error the model reads', async () => {
      const read = await readThrough(server, 'librarian', 'get_prompt', { name: 'farewell' });

      expect(JSON.parse(read)).toEqual({ error: 'Prompt not found: farewell' });
    });

    it('answers a missing required argument as the tool error the model reads', async () => {
      const read = await readThrough(server, 'librarian', 'get_prompt', { name: 'greeting' });

      expect(JSON.parse(read)).toHaveProperty('error');
      expect(runs).toEqual([]);
    });
  });
});

describe("an agent's own tool by a built-in's name", () => {
  it.each([
    ['read_resource', { resources: [ShelfResource] }],
    ['list_prompts', { prompts: [GreetingPrompt] }],
  ])('fails startup when it is named %s', async (name, declares) => {
    @Tool({ name, inputSchema: {} })
    class ClashingTool extends ToolContext {
      async execute() {
        return {};
      }
    }

    @Agent({
      name: 'clasher',
      inputSchema: {},
      llm: { adapter: scriptedModel('clasher') },
      tools: [ClashingTool],
      ...declares,
    })
    class ClasherAgent extends AgentContext {}

    @App({ id: 'clash', name: 'Clash', agents: [ClasherAgent] })
    class ClashApp {}

    const start = FrontMcpInstance.createDirect({
      info: { name: 'agent-reads-clash', version: '1.0.0' },
      apps: [ClashApp],
      logging: { level: LogLevel.Off },
    });

    await expect(start).rejects.toBeInstanceOf(AgentConfigurationError);
    await expect(start).rejects.toThrow(
      `Agent "clasher" has a tool named "${name}", the name of a built-in tool its model reads the agent's resources and prompts with. Rename the tool.`,
    );
  });
});

// ---------------------------------------------------------------- authorities and publicAccess

@Resource({ name: 'vault', uri: 'library://vault', authorities: 'admin' })
class VaultResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'the vault' }] };
  }
}

@Agent({ name: 'warden', inputSchema, llm: { adapter: scriptedModel('warden') }, resources: [VaultResource] })
class WardenAgent extends AgentContext {}

@App({ id: 'keep', name: 'Keep', agents: [WardenAgent] })
class KeepApp {}

describe("authorities on an agent's resource", () => {
  it('apply to the caller the agent runs for', async () => {
    const issuer = await createTestJwtIssuer();
    const server = await createTestFetchServer({
      info: { name: 'agent-reads-authorities', version: '1.0.0' },
      apps: [KeepApp],
      auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } },
      authorities: { claimsMapping: { roles: 'roles' }, profiles: { admin: { roles: { any: ['admin'] } } } },
    });

    const readAs = async (roles: string[], sub: string) => {
      const token = await issuer.sign({ roles }, sub);
      const { message } = await rpc20260728(
        server.handler,
        'tools/call',
        { name: 'invoke_warden', arguments: { tool: 'read_resource', args: { uri: 'library://vault' } } },
        { headers: { authorization: `Bearer ${token}` } },
      );
      return ((message.result?.['structuredContent'] ?? {}) as { read?: string }).read;
    };

    expect(await readAs(['admin'], 'ada')).toBe('the vault');
    expect(JSON.parse((await readAs(['member'], 'max')) ?? '{}')).toEqual({
      error: expect.stringContaining('Access denied to Resource'),
    });
  });
});

@Prompt({ name: 'motto', arguments: [] })
class MottoPrompt extends PromptContext {
  async execute() {
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Read widely' } }] };
  }
}

@Agent({ name: 'guide', inputSchema, llm: { adapter: scriptedModel('guide') }, prompts: [MottoPrompt] })
class GuideAgent extends AgentContext {}

@App({ id: 'lobby', name: 'Lobby', agents: [GuideAgent] })
class LobbyApp {}

describe("publicAccess and an agent's prompts", () => {
  it("lets the model of an agent an anonymous caller may call get and list the agent's prompts", async () => {
    const server = await createTestFetchServer({
      info: { name: 'agent-reads-public', version: '1.0.0' },
      apps: [LobbyApp],
      auth: { mode: 'public', publicAccess: { tools: ['invoke_guide'], prompts: [] } },
    });

    const call = async (tool: string, args?: Record<string, unknown>) => {
      const { message } = await rpc20260728(server.handler, 'tools/call', {
        name: 'invoke_guide',
        arguments: { tool, ...(args && { args }) },
      });
      return ((message.result?.['structuredContent'] ?? {}) as { read?: string }).read;
    };

    expect(await call('get_prompt', { name: 'motto' })).toBe('[user]\nRead widely');
    expect(JSON.parse((await call('list_prompts')) ?? '{}')).toEqual({ prompts: [{ name: 'motto', arguments: [] }] });
  });
});

// ---------------------------------------------------------------- results as the model reads them

describe('resourceContentsToText', () => {
  it('heads each of several contents with its URI and MIME type', () => {
    expect(
      resourceContentsToText({
        contents: [
          { uri: 'a://1', mimeType: 'text/plain', text: 'one' },
          { uri: 'a://2', text: 'two' },
          { uri: 'a://3', blob: 'AAAA' },
        ],
      }),
    ).toBe(
      '[a://1] (text/plain)\none\n\n[a://2]\ntwo\n\n[binary content omitted: a://3 (application/octet-stream, 3 bytes)]',
    );
  });

  it('says when a resource has no content', () => {
    expect(resourceContentsToText({ contents: [] })).toBe('(the resource has no content)');
  });

  it('counts the bytes of padded base64', () => {
    expect(resourceContentsToText({ contents: [{ uri: 'a://1', blob: 'QQ==' }] })).toBe(
      '[binary content omitted: a://1 (application/octet-stream, 1 bytes)]',
    );
    expect(resourceContentsToText({ contents: [{ uri: 'a://1', blob: 'QUI=' }] })).toBe(
      '[binary content omitted: a://1 (application/octet-stream, 2 bytes)]',
    );
  });
});

describe('promptResultToText', () => {
  it('describes binary content and names resource links', () => {
    const result: GetPromptResult = {
      messages: [
        { role: 'user', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } },
        { role: 'user', content: { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' } },
        { role: 'user', content: { type: 'resource_link', uri: 'library://shelf', name: 'shelf' } },
        { role: 'user', content: { type: 'resource_link', uri: 'library://cover', name: '' } },
        { role: 'user', content: { type: 'resource', resource: { uri: 'library://shelf', text: 'three books' } } },
        {
          role: 'assistant',
          content: { type: 'resource', resource: { uri: 'library://cover', mimeType: 'image/png', blob: 'AAAA' } },
        },
      ],
    };

    expect(promptResultToText(result)).toBe(
      [
        '[user]\n[image omitted (image/png)]',
        '[user]\n[audio omitted (audio/wav)]',
        '[user]\n[resource link: library://shelf (shelf)]',
        '[user]\n[resource link: library://cover]',
        '[user]\nthree books',
        '[assistant]\n[binary content omitted: library://cover (image/png, 3 bytes)]',
      ].join('\n\n'),
    );
  });

  it('names content of a type it does not know', () => {
    const result = { messages: [{ role: 'user', content: { type: 'hologram' } }] } as unknown as GetPromptResult;

    expect(promptResultToText(result)).toBe('[user]\n[hologram content omitted]');
  });
});

describe('describePromptListing', () => {
  it('keeps a title and leaves out what a prompt does not set', () => {
    expect(
      describePromptListing({ prompts: [{ name: 'motto', title: 'Motto', arguments: [{ name: 'tone' }] }] }),
    ).toEqual({ prompts: [{ name: 'motto', title: 'Motto', arguments: [{ name: 'tone' }] }] });
  });
});
