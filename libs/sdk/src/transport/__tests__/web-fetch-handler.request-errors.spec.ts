/**
 * A client's mistake (a malformed request, an unknown prompt or resource, a missing argument) is answered as that
 * mistake, and the server logs no error for it. A legacy `initialize` on a Worker logs no session warning either.
 */
import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Prompt, PromptContext, Resource, ResourceContext, Tool, ToolContext } from '../../common';

let toolRuns = 0;

@Tool({ name: 'count_runs', description: 'Counts how often it runs', inputSchema: {} })
class CountRunsTool extends ToolContext {
  async execute() {
    toolRuns += 1;
    return { content: [{ type: 'text' as const, text: String(toolRuns) }] };
  }
}

@Prompt({ name: 'greeting', arguments: [{ name: 'visitor', required: true }] })
class GreetingPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Hi ${args['visitor']}` } }] };
  }
}

@Resource({ name: 'shelf', uri: 'library://shelf', mimeType: 'text/plain' })
class ShelfResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'three books' }] };
  }
}

@App({
  id: 'request-errors',
  name: 'request-errors',
  tools: [CountRunsTool],
  prompts: [GreetingPrompt],
  resources: [ShelfResource],
})
class RequestErrorsApp {}

function loggedLines(spy: jest.SpyInstance): string[] {
  return spy.mock.calls.map((args: unknown[]) => args.map(String).join(' '));
}

describe('web-fetch handler: client mistakes are answered without server errors', () => {
  let server: TestFetchServer;
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'request-errors', version: '1.0.0' },
      apps: [RequestErrorsApp],
      logging: { level: LogLevel.Warn },
    });
  });

  afterAll(async () => {
    await server?.instance.shutdown();
  });

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it('answers a tools/call without a name with Invalid params', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/call', { arguments: {} });

    expect(message.error?.code).toBe(-32602);
    expect(message.error?.message).toContain('params.name');
    expect(loggedLines(consoleError)).toEqual([]);
  });

  it.each([
    ['not an object', 'invalid'],
    ['an answer that is not an object', { confirm: 'yes' }],
  ])(
    'answers inputResponses that is %s with Invalid params, without running the tool',
    async (_label, inputResponses) => {
      const runsBefore = toolRuns;

      const { message } = await rpc20260728(server.handler, 'tools/call', {
        name: 'count_runs',
        arguments: {},
        inputResponses,
      });

      expect(message.error?.code).toBe(-32602);
      expect(message.error?.message).toContain('params.inputResponses');
      expect(toolRuns).toBe(runsBefore);
    },
  );

  it('runs the tool for well-formed inputResponses', async () => {
    const runsBefore = toolRuns;

    const { message } = await rpc20260728(server.handler, 'tools/call', {
      name: 'count_runs',
      arguments: {},
      inputResponses: { confirm: { action: 'accept', content: {} } },
    });

    expect(message.error).toBeUndefined();
    expect(toolRuns).toBe(runsBefore + 1);
  });

  it.each([
    ['an unknown prompt', 'prompts/get', { name: 'no_such_prompt' }],
    ['a prompt without its required argument', 'prompts/get', { name: 'greeting', arguments: {} }],
    ['an unknown resource', 'resources/read', { uri: 'library://missing' }],
  ])('answers %s with Invalid params and logs no finalize error', async (_label, method, params) => {
    const { message } = await rpc20260728(server.handler, method, params);

    expect(message.error?.code).toBe(-32602);
    expect(loggedLines(consoleError)).toEqual([]);
  });

  it('records no client details for the session a Worker never registers on a legacy initialize', async () => {
    const response = await server.handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1.0.0' } },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"serverInfo"');
    expect(loggedLines(consoleWarn).filter((line) => line.includes('unregistered session'))).toEqual([]);
  });
});
