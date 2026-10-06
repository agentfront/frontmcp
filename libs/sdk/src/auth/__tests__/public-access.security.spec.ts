/**
 * `publicAccess` and `anonymousScopes` of a public server (#766): an anonymous
 * caller sees and calls only the tools and prompts `publicAccess` lists, within
 * `publicAccess.rateLimit` calls a minute, and holds the `anonymousScopes`.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Prompt, PromptContext, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@Tool({ name: 'search', inputSchema: {} })
class SearchTool extends ToolContext {
  async execute() {
    return { scopes: this.auth.scopes };
  }
}

@Tool({ name: 'delete_ticket', inputSchema: {} })
class DeleteTicketTool extends ToolContext {
  async execute() {
    return 'deleted';
  }
}

@Prompt({ name: 'summarize', arguments: [] })
class SummarizePrompt extends PromptContext {
  async execute() {
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'summarize' } }] };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [SearchTool, DeleteTicketTool], prompts: [SummarizePrompt] })
class DeskApp {}

const ORIGIN = 'https://desk.example.com';
const servers: TestFetchServer[] = [];

afterAll(async () => {
  await disposeServers(servers);
});

async function serverWith(auth: NonNullable<FrontMcpConfigInput['auth']>): Promise<TestFetchServer> {
  const server = await createTestFetchServer({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp], auth });
  servers.push(server);
  return server;
}

/** The JSON-RPC message of a response, whether it came as JSON or as one SSE event. */
async function messageOf(
  response: Response,
): Promise<{ result?: Record<string, unknown>; error?: { message: string } }> {
  const text = await response.text();
  const data = text.trimStart().startsWith('{')
    ? text
    : text
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5))
        .join('');
  return JSON.parse(data);
}

async function session(server: TestFetchServer) {
  let id = 0;
  let sessionId = '';
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await server.handler(
      new Request(`${ORIGIN}/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      }),
    );
    sessionId ||= response.headers.get('mcp-session-id') ?? '';
    return messageOf(response);
  };
  await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'spec', version: '1' },
  });
  return send;
}

describe('publicAccess on a public server', () => {
  it('lists and runs only the tools and prompts it names for an anonymous caller', async () => {
    const send = await session(await serverWith({ mode: 'public', publicAccess: { tools: ['search'], prompts: [] } }));

    const tools = await send('tools/list');
    const prompts = await send('prompts/list');
    const refusedTool = await send('tools/call', { name: 'delete_ticket', arguments: {} });
    const refusedPrompt = await send('prompts/get', { name: 'summarize' });
    const allowed = await send('tools/call', { name: 'search', arguments: {} });

    expect((tools.result?.['tools'] as Array<{ name: string }>).map((tool) => tool.name)).toEqual(['search']);
    expect(prompts.result?.['prompts']).toEqual([]);
    expect(JSON.stringify(refusedTool)).toContain('not available to anonymous callers');
    expect(JSON.stringify(refusedPrompt)).toContain('not available to anonymous callers');
    expect(JSON.stringify(allowed.result)).not.toContain('not available');
  });

  it('refuses an anonymous completion for a prompt it does not name', async () => {
    const send = await session(await serverWith({ mode: 'public', publicAccess: { tools: ['search'], prompts: [] } }));

    const refused = await send('completion/complete', {
      ref: { type: 'ref/prompt', name: 'summarize' },
      argument: { name: 'topic', value: 'b' },
    });

    expect(JSON.stringify(refused)).toContain('not available to anonymous callers');
  });

  it('counts anonymous calls against rateLimit', async () => {
    const send = await session(await serverWith({ mode: 'public', publicAccess: { rateLimit: 2 } }));

    await send('tools/call', { name: 'search', arguments: {} });
    await send('tools/call', { name: 'search', arguments: {} });
    const third = await send('tools/call', { name: 'search', arguments: {} });

    expect(JSON.stringify(third).toLowerCase()).toContain('rate limit');
  });

  it('gives anonymous callers the anonymousScopes', async () => {
    const send = await session(await serverWith({ mode: 'public', anonymousScopes: ['tickets:read'] }));

    const result = await send('tools/call', { name: 'search', arguments: {} });

    expect(JSON.stringify(result.result)).toContain('tickets:read');
  });
});

describe('publicAccess.rateLimit and a task-augmented call', () => {
  it('counts the call once, not again when the task runner re-dispatches it (#766)', async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      auth: { mode: 'public', publicAccess: { rateLimit: 1 } },
    });
    const scope = instance.getScopes()[0];
    if (!scope) throw new Error('the server config produced no scope');
    const request = { method: 'tools/call' as const, params: { name: 'search', arguments: {} } };

    await scope.runFlowForOutput('tools:call-tool', { request, ctx: { authInfo: {} } });
    const redispatched = await scope.runFlowForOutput('tools:call-tool', {
      request,
      ctx: { authInfo: {}, taskId: 'task-1' },
    });

    expect(JSON.stringify(redispatched).toLowerCase()).not.toContain('rate limit');
  });
});
