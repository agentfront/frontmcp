/**
 * CodeCall options that 1.9.1 accepted and ignored (#767), driven through a real server: `topK`,
 * `maxDefinitions`, `vm.allowLoops` and `embedding.synonymExpansion: false`, and `console`, which the
 * sandbox never gives a script.
 */
import 'reflect-metadata';

import { Client, type CallToolResult } from '@frontmcp/protocol';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput } from '../codecall.types';

const TICKET_TOOLS = [
  ['create_ticket', 'Create a new support ticket'],
  ['get_ticket', 'Get a support ticket by id'],
  ['close_ticket', 'Close a support ticket'],
  ['assign_ticket', 'Assign a support ticket to an agent'],
  ['tag_ticket', 'Tag a support ticket'],
  ['comment_ticket', 'Comment on a support ticket'],
  ['reopen_ticket', 'Reopen a closed support ticket'],
] as const;

function ticketTool(name: string, description: string) {
  @Tool({ name, description, inputSchema: {} })
  class TicketTool extends ToolContext {
    async execute() {
      return { ran: name };
    }
  }
  return TicketTool;
}

interface CodeCallServer {
  client: Client;
  close(): Promise<void>;
}

async function startCodeCallServer(codecallOptions: CodeCallPluginOptionsInput): Promise<CodeCallServer> {
  @App({
    id: 'desk',
    name: 'Desk',
    tools: TICKET_TOOLS.map(([name, description]) => ticketTool(name, description)),
    plugins: [CodeCallPlugin.init(codecallOptions)],
  })
  class DeskApp {}

  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'codecall-options', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
  });
  const scope = instance.getScopes()[0];
  if (!scope) throw new Error('the server config produced no scope');

  const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'codecall-options-spec', version: '1.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close();
      await close();
    },
  };
}

function readStructured<T>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as T;
}

function useCodeCallServer(codecallOptions: CodeCallPluginOptionsInput): () => CodeCallServer {
  let server: CodeCallServer | undefined;

  beforeAll(async () => {
    server = await startCodeCallServer(codecallOptions);
  });

  afterAll(async () => {
    await server?.close();
  });

  return () => {
    if (!server) throw new Error('the CodeCall server has not started');
    return server;
  };
}

async function callCodeCall(server: CodeCallServer, name: string, args: Record<string, unknown>) {
  return (await server.client.callTool({ name, arguments: args })) as CallToolResult;
}

async function searchToolNames(server: CodeCallServer, args: Record<string, unknown>): Promise<string[]> {
  const result = await callCodeCall(server, 'codecall:search', args);
  return readStructured<{ tools: Array<{ name: string }> }>(result).tools.map((tool) => tool.name);
}

async function runScript(server: CodeCallServer, script: string): Promise<{ status: string; error?: unknown }> {
  return readStructured(await callCodeCall(server, 'codecall:execute', { script }));
}

describe('CodeCall topK', () => {
  const server = useCodeCallServer({ mode: 'codecall_only', topK: 2 });

  it('limits results per query to the plugin topK when the call names none', async () => {
    expect(await searchToolNames(server(), { queries: ['support ticket'], minRelevanceScore: 0 })).toHaveLength(2);
  });

  it('lets a call ask for more results', async () => {
    expect(
      await searchToolNames(server(), { queries: ['support ticket'], minRelevanceScore: 0, topK: 5 }),
    ).toHaveLength(5);
  });
});

describe('CodeCall maxDefinitions', () => {
  const server = useCodeCallServer({ mode: 'codecall_only', maxDefinitions: 2 });

  it('refuses a describe call that names more tools than maxDefinitions', async () => {
    const result = await callCodeCall(server(), 'codecall:describe', {
      toolNames: ['create_ticket', 'get_ticket', 'close_ticket'],
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('at most 2 tools per call');
  });

  it('describes up to maxDefinitions tools', async () => {
    const result = await callCodeCall(server(), 'codecall:describe', { toolNames: ['create_ticket', 'get_ticket'] });

    expect(result.isError).toBeFalsy();
    expect(readStructured<{ tools: unknown[] }>(result).tools).toHaveLength(2);
  });
});

describe('CodeCall vm.allowLoops', () => {
  const FOR_LOOP = 'let total = 0;\nfor (let i = 0; i < 3; i++) { total += i; }\nreturn total;';

  describe('when false', () => {
    const server = useCodeCallServer({ mode: 'codecall_only', vm: { allowLoops: false } });

    it('refuses a for loop', async () => {
      const outcome = await runScript(server(), FOR_LOOP);

      expect(outcome.status).toBe('illegal_access');
      expect(JSON.stringify(outcome.error)).toContain('vm.allowLoops is false');
    });

    it('still runs a for-of loop', async () => {
      const outcome = await runScript(
        server(),
        'let total = 0;\nfor (const n of [1, 2, 3]) { total += n; }\nreturn total;',
      );

      expect(outcome.status).toBe('ok');
    });
  });

  describe('when true', () => {
    const server = useCodeCallServer({ mode: 'codecall_only', vm: { allowLoops: true } });

    it('runs a for loop', async () => {
      expect((await runScript(server(), FOR_LOOP)).status).toBe('ok');
    });
  });
});

describe('CodeCall console in scripts', () => {
  const server = useCodeCallServer({ mode: 'codecall_only', vm: { allowConsole: true } });

  it('refuses console with a message that names mcpLog', async () => {
    const outcome = await runScript(server(), 'console.log("hi");\nreturn 1;');

    expect(outcome.status).toBe('illegal_access');
    expect(JSON.stringify(outcome.error)).toContain('use mcpLog');
  });
});

describe('CodeCall embedding.synonymExpansion', () => {
  describe('when false', () => {
    const server = useCodeCallServer({ mode: 'codecall_only', embedding: { synonymExpansion: false } });

    it('does not match synonyms', async () => {
      expect(await searchToolNames(server(), { queries: ['add issue'] })).not.toContain('create_ticket');
    });
  });

  describe('by default', () => {
    const server = useCodeCallServer({ mode: 'codecall_only' });

    it('matches synonyms', async () => {
      expect(await searchToolNames(server(), { queries: ['add issue'] })).toContain('create_ticket');
    });
  });
});
