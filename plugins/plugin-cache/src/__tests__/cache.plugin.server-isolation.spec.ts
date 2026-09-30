/**
 * Every server keeps its own memory cache, even when several servers in one process are built from
 * the same app and plugin record (#647).
 *
 * The memory store was created once, when the plugin module or `CachePlugin.init()` ran, so every
 * server shared it; and a plugin record reused by two servers resolved its store from whichever
 * server registered last.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

let executions: string[] = [];

@Tool({ name: 'get_quote', description: 'Returns a quote', inputSchema: {}, cache: true })
class GetQuoteTool extends ToolContext {
  async execute() {
    executions.push('get_quote');
    return { quote: 'hello' };
  }
}

@App({ id: 'quotes', name: 'Quotes', plugins: [CachePlugin.init({ type: 'memory' })], tools: [GetQuoteTool] })
class QuotesApp {}

@App({ id: 'quotes', name: 'Quotes', plugins: [CachePlugin], tools: [GetQuoteTool] })
class DefaultStoreQuotesApp {}

const CALLER = { authContext: { sessionId: 'session-quotes', user: { sub: 'alice' } } };

async function buildServer(app: typeof QuotesApp): Promise<DirectMcpServer> {
  return FrontMcpInstance.createDirect({
    info: { name: 'cache-server-isolation', version: '1.0.0' },
    apps: [app],
    logging: { level: LogLevel.Off },
  });
}

describe.each([
  ['CachePlugin.init({ type: "memory" })', QuotesApp],
  ['the default memory store of CachePlugin', DefaultStoreQuotesApp],
])('CachePlugin — one memory cache per server, with %s (#647)', (_label, app) => {
  let first: DirectMcpServer;
  let second: DirectMcpServer;

  beforeEach(async () => {
    executions = [];
    first = await buildServer(app);
    second = await buildServer(app);
  });

  afterEach(async () => {
    await first.dispose();
    await second.dispose();
  });

  it('does not serve one server the entry another server cached', async () => {
    await first.callTool('get_quote', {}, CALLER);
    const fromSecond = await second.callTool('get_quote', {}, CALLER);

    expect({ executions, cache: fromSecond._meta?.['cache'] }).toEqual({
      executions: ['get_quote', 'get_quote'],
      cache: undefined,
    });
  });

  it('still serves each server its own entries', async () => {
    await first.callTool('get_quote', {}, CALLER);
    await second.callTool('get_quote', {}, CALLER);
    const fromFirst = await first.callTool('get_quote', {}, CALLER);
    const fromSecond = await second.callTool('get_quote', {}, CALLER);

    expect({
      executions: executions.length,
      first: fromFirst._meta?.['cache'],
      second: fromSecond._meta?.['cache'],
    }).toEqual({ executions: 2, first: 'hit', second: 'hit' });
  });
});
