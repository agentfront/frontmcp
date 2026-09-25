import 'reflect-metadata';

import { inspect } from 'node:util';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  Agent,
  AgentContext,
  App,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type LogRecord,
} from '../../common';

const THROWN_MESSAGE = 'db timeout while loading order 1234';
const FAILED_MESSAGE = 'payment provider returned 502 for order 1234';
const RESOURCE_MESSAGE = 'inventory store unreachable while reading stock';
const PROMPT_MESSAGE = 'template store unreachable while rendering summary';
const AGENT_MESSAGE = 'refund ledger unreachable while planning refund';
const FAKE_SESSION_SECRET = 'error-id-logging-spec-fake-session-secret-0123456789';

const capturedLogLines: string[] = [];

function formatLogArgument(value: unknown): string {
  return typeof value === 'string' ? value : inspect(value, { depth: 6, breakLength: Infinity });
}

@LogTransport({ name: 'ErrorIdCaptureLogger', description: 'Captures every log record for assertions' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    capturedLogLines.push([record.message, ...record.args].map(formatLogArgument).join(' '));
  }
}

@Tool({ name: 'lookup', inputSchema: { how: z.string() } })
class LookupTool extends ToolContext {
  async execute(input: { how: string }) {
    if (input.how === 'throw') throw new Error(THROWN_MESSAGE);
    this.fail(new Error(FAILED_MESSAGE));
  }
}

@Resource({ name: 'stock', uri: 'stock://today', mimeType: 'text/plain' })
class StockResource extends ResourceContext {
  async execute(): Promise<{ contents: [] }> {
    throw new Error(RESOURCE_MESSAGE);
  }
}

@Prompt({ name: 'summary', arguments: [] })
class SummaryPrompt extends PromptContext {
  async execute(): Promise<{ messages: [] }> {
    throw new Error(PROMPT_MESSAGE);
  }
}

@Agent({
  name: 'refunds',
  inputSchema: {},
  llm: { adapter: { completion: jest.fn(), streamCompletion: jest.fn() } },
})
class RefundsAgent extends AgentContext {
  override async execute(_input: Record<string, never>): Promise<Record<string, never>> {
    throw new Error(AGENT_MESSAGE);
  }
}

@App({
  id: 'shop',
  name: 'shop',
  tools: [LookupTool],
  resources: [StockResource],
  prompts: [SummaryPrompt],
  agents: [RefundsAgent],
})
class ShopApp {}

describe('error ids in production logs', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalSessionSecret = process.env['MCP_SESSION_SECRET'];
  let server: TestFetchServer;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['MCP_SESSION_SECRET'] = FAKE_SESSION_SECRET;
    server = await createTestFetchServer({
      info: { name: 'error-id-logging', version: '1.0.0' },
      apps: [ShopApp],
      logging: { level: LogLevel.Info, enableConsole: false, transports: [CaptureLogTransport] },
    });
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    if (originalSessionSecret === undefined) delete process.env['MCP_SESSION_SECRET'];
    else process.env['MCP_SESSION_SECRET'] = originalSessionSecret;
  });

  async function callLookupAndCaptureLogs(how: string) {
    const firstLineOfCall = capturedLogLines.length;
    const { message } = await rpc20260728(server.handler, 'tools/call', { name: 'lookup', arguments: { how } });
    const result = message.result as { content: Array<{ text: string }>; _meta: { errorId: string } };
    const serverLogLines = capturedLogLines.slice(firstLineOfCall);
    return {
      errorId: result._meta.errorId,
      clientText: result.content[0]?.text ?? '',
      serverLog: serverLogLines.join('\n'),
      serverLogLines,
    };
  }

  it('logs the error id shown to the client for an Error thrown in execute()', async () => {
    const { errorId, clientText, serverLog } = await callLookupAndCaptureLogs('throw');

    expect(clientText).toContain(errorId);
    expect(serverLog).toContain(THROWN_MESSAGE);
    expect(serverLog).toContain(errorId);
  });

  it('logs an Error thrown in execute() once', async () => {
    const { serverLogLines } = await callLookupAndCaptureLogs('throw');

    expect(serverLogLines.filter((line) => line.includes(THROWN_MESSAGE))).toHaveLength(1);
  });

  it('logs the failure of an Error passed to this.fail() once', async () => {
    const { serverLogLines } = await callLookupAndCaptureLogs('fail');

    expect(serverLogLines.filter((line) => line.includes(FAILED_MESSAGE))).toHaveLength(1);
  });

  it('logs the error id shown to the client for an Error passed to this.fail()', async () => {
    const { errorId, clientText, serverLog } = await callLookupAndCaptureLogs('fail');

    expect(clientText).toContain(errorId);
    expect(serverLog).toContain(errorId);
  });

  it('logs the error id returned in the data of an error with a JSON-RPC shape', async () => {
    const firstLineOfCall = capturedLogLines.length;

    const { message } = await rpc20260728(server.handler, 'resources/read', { uri: 'orders://missing' });

    const errorId = (message.error?.data as { errorId?: string } | undefined)?.errorId;
    expect(errorId).toMatch(/^err_/);
    expect(capturedLogLines.slice(firstLineOfCall).join('\n')).toContain(errorId);
  });

  it.each([
    ['resources/read', { uri: 'stock://today' }, RESOURCE_MESSAGE],
    ['prompts/get', { name: 'summary', arguments: {} }, PROMPT_MESSAGE],
    ['tools/call', { name: 'invoke_refunds', arguments: {} }, AGENT_MESSAGE],
  ])('logs an Error thrown while serving %s once', async (method, params, thrownMessage) => {
    const firstLineOfCall = capturedLogLines.length;

    await rpc20260728(server.handler, method, params);

    const serverLogLines = capturedLogLines.slice(firstLineOfCall);
    expect(serverLogLines.filter((line) => line.includes(thrownMessage))).toHaveLength(1);
  });
});
