/**
 * A cache hit answers with the same result the tool gave on the miss, through the real
 * tools:call-tool flow (#647).
 *
 * The plugin used to merge `_meta: { cache: 'hit' }` into the cached value itself, so a tool
 * without an outputSchema returned `_meta` inside `structuredContent` and inside the text block.
 * The marker belongs on the result's own `_meta`.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

let executions = 0;

@Tool({ name: 'get_weather', description: 'Returns the weather for a city', inputSchema: {}, cache: true })
class GetWeatherTool extends ToolContext {
  async execute() {
    executions += 1;
    return { city: 'Lisbon', forecast: 'sunny' };
  }
}

@Tool({
  name: 'get_tagged_weather',
  description: 'Returns the weather with its own _meta',
  inputSchema: {},
  cache: true,
})
class GetTaggedWeatherTool extends ToolContext {
  async execute() {
    executions += 1;
    return { city: 'Porto', _meta: { source: 'station-7' } };
  }
}

@App({
  id: 'weather',
  name: 'Weather',
  plugins: [CachePlugin.init({ type: 'memory' })],
  tools: [GetWeatherTool, GetTaggedWeatherTool],
})
class WeatherApp {}

describe('CachePlugin — the result of a cache hit (#647)', () => {
  let server: DirectMcpServer;
  // A caller of its own per test, so no test reads an entry an earlier one cached.
  let callers = 0;
  let caller: { authContext: { sessionId: string; user: { sub: string } } };

  beforeEach(async () => {
    executions = 0;
    callers += 1;
    caller = { authContext: { sessionId: `session-weather-${callers}`, user: { sub: `caller-${callers}` } } };
    server = await FrontMcpInstance.createDirect({
      info: { name: 'cache-hit-result', version: '1.0.0' },
      apps: [WeatherApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('answers a hit with the content and structuredContent of the miss', async () => {
    const miss = await server.callTool('get_weather', {}, caller);
    const hit = await server.callTool('get_weather', {}, caller);

    expect(executions).toBe(1);
    expect({ content: hit.content, structuredContent: hit.structuredContent }).toEqual({
      content: miss.content,
      structuredContent: miss.structuredContent,
    });
  });

  it('keeps _meta out of the data a hit returns', async () => {
    await server.callTool('get_weather', {}, caller);
    const hit = await server.callTool('get_weather', {}, caller);
    const text = hit.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');

    expect({ structuredContent: hit.structuredContent, text }).toEqual({
      structuredContent: { city: 'Lisbon', forecast: 'sunny' },
      text: expect.not.stringContaining('_meta'),
    });
  });

  it('marks a hit on the result _meta', async () => {
    await server.callTool('get_weather', {}, caller);
    const hit = await server.callTool('get_weather', {}, caller);

    expect(hit._meta?.['cache']).toBe('hit');
  });

  it('does not mark a miss', async () => {
    const miss = await server.callTool('get_weather', {}, caller);

    expect(miss._meta?.['cache']).toBeUndefined();
  });

  it('keeps the _meta a tool returns itself next to the hit marker', async () => {
    await server.callTool('get_tagged_weather', {}, caller);
    const hit = await server.callTool('get_tagged_weather', {}, caller);

    expect(hit._meta).toMatchObject({ source: 'station-7', cache: 'hit' });
  });
});
