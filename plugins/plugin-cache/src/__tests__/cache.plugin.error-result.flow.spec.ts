/**
 * A result a tool returns with `isError: true` is not cached (#678).
 *
 * The plugin stored whatever `execute()` returned, so a tool that reported a failure (a timeout
 * upstream, a missing record) answered every later call with the same error until the TTL ran
 * out, without running again.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type CallToolResult,
  type DirectMcpServer,
} from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

let executions = 0;
let failNext = true;

@Tool({ name: 'fetch_rates', description: 'Fails the first time', inputSchema: {}, cache: true })
class FetchRatesTool extends ToolContext {
  async execute(): Promise<CallToolResult> {
    executions += 1;
    if (failNext) {
      failNext = false;
      return { content: [{ type: 'text', text: 'rates service timed out' }], isError: true };
    }
    return { content: [{ type: 'text', text: 'EUR 1.08' }] };
  }
}

@Tool({
  name: 'lookup_rate',
  description: 'Fails the first time, with an output schema',
  inputSchema: { currency: z.string() },
  cache: true,
})
class LookupRateTool extends ToolContext {
  async execute(input: { currency: string }): Promise<CallToolResult> {
    executions += 1;
    if (failNext) {
      failNext = false;
      return { content: [{ type: 'text', text: `no rate for ${input.currency}` }], isError: true };
    }
    return { content: [{ type: 'text', text: `${input.currency} 1.08` }], isError: false };
  }
}

@App({
  id: 'rates',
  name: 'Rates',
  plugins: [CachePlugin.init({ type: 'memory' })],
  tools: [FetchRatesTool, LookupRateTool],
})
class RatesApp {}

describe('CachePlugin — error results (#678)', () => {
  let server: DirectMcpServer;
  const caller = { authContext: { sessionId: 'session-rates', user: { sub: 'rates-caller' } } };

  beforeEach(async () => {
    executions = 0;
    failNext = true;
    server = await FrontMcpInstance.createDirect({
      info: { name: 'cache-error-result', version: '1.0.0' },
      apps: [RatesApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('runs the tool again after it returned isError', async () => {
    const failed = await server.callTool('fetch_rates', {}, caller);
    const retried = await server.callTool('fetch_rates', {}, caller);

    expect(failed.isError).toBe(true);
    expect(executions).toBe(2);
    expect(retried.isError).toBeFalsy();
    expect(retried.content).toEqual([{ type: 'text', text: 'EUR 1.08' }]);
    expect(retried._meta?.['cache']).toBeUndefined();
  });

  it('caches the successful result that follows', async () => {
    await server.callTool('fetch_rates', {}, caller);
    await server.callTool('fetch_rates', {}, caller);
    const hit = await server.callTool('fetch_rates', {}, caller);

    expect(executions).toBe(2);
    expect(hit._meta?.['cache']).toBe('hit');
    expect(hit.content).toEqual([{ type: 'text', text: 'EUR 1.08' }]);
  });

  it('caches a result with isError: false', async () => {
    await server.callTool('lookup_rate', { currency: 'EUR' }, caller);
    await server.callTool('lookup_rate', { currency: 'EUR' }, caller);
    const hit = await server.callTool('lookup_rate', { currency: 'EUR' }, caller);

    expect(executions).toBe(2);
    expect(hit._meta?.['cache']).toBe('hit');
  });
});
