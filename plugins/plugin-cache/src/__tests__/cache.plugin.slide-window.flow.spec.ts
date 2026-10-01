/**
 * When a cache read refreshes an entry's TTL (#678).
 *
 * `slideWindow` defaults to `false`, and `cache: true` means "the plugin defaults", yet a hit on a
 * `cache: true` tool always rewrote the entry with a fresh TTL, so an entry read often enough
 * never expired. `{ slideWindow: true }` without a `ttl`, on the other hand, never slid.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

const DEFAULT_TTL_SECONDS = 10;

const executions = new Map<string, number>();

function run(name: string): { runs: number } {
  const runs = (executions.get(name) ?? 0) + 1;
  executions.set(name, runs);
  return { runs };
}

@Tool({ name: 'plugin_defaults', description: 'cache: true', inputSchema: {}, cache: true })
class PluginDefaultsTool extends ToolContext {
  async execute() {
    return run('plugin_defaults');
  }
}

@Tool({ name: 'fixed_ttl', description: 'A ttl without slideWindow', inputSchema: {}, cache: { ttl: 10 } })
class FixedTtlTool extends ToolContext {
  async execute() {
    return run('fixed_ttl');
  }
}

@Tool({
  name: 'sliding_ttl',
  description: 'A ttl with slideWindow',
  inputSchema: {},
  cache: { ttl: 10, slideWindow: true },
})
class SlidingTtlTool extends ToolContext {
  async execute() {
    return run('sliding_ttl');
  }
}

@Tool({
  name: 'sliding_default_ttl',
  description: 'slideWindow over the plugin default TTL',
  inputSchema: {},
  cache: { slideWindow: true },
})
class SlidingDefaultTtlTool extends ToolContext {
  async execute() {
    return run('sliding_default_ttl');
  }
}

@App({
  id: 'reports',
  name: 'Reports',
  plugins: [CachePlugin.init({ type: 'memory', defaultTTL: DEFAULT_TTL_SECONDS })],
  tools: [PluginDefaultsTool, FixedTtlTool, SlidingTtlTool, SlidingDefaultTtlTool],
})
class ReportsApp {}

describe('CachePlugin — which reads refresh the TTL (#678)', () => {
  let server: DirectMcpServer;
  let now: number;
  const caller = { authContext: { sessionId: 'session-reports', user: { sub: 'reports-caller' } } };

  beforeEach(async () => {
    executions.clear();
    now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    server = await FrontMcpInstance.createDirect({
      info: { name: 'cache-slide-window', version: '1.0.0' },
      apps: [ReportsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
    jest.restoreAllMocks();
  });

  /** Fills the cache, reads it 6s later, and calls again 11s after the fill: 1s past the first TTL. */
  async function runsAfterAHitAndTheFirstTtl(tool: string): Promise<number> {
    await server.callTool(tool, {}, caller);
    now += 6_000;
    await server.callTool(tool, {}, caller);
    now += 5_000;
    const last = await server.callTool(tool, {}, caller);
    return (last.structuredContent as { runs: number }).runs;
  }

  it('does not slide the TTL of a cache: true tool', async () => {
    await expect(runsAfterAHitAndTheFirstTtl('plugin_defaults')).resolves.toBe(2);
  });

  it('does not slide the TTL of a tool with a ttl and no slideWindow', async () => {
    await expect(runsAfterAHitAndTheFirstTtl('fixed_ttl')).resolves.toBe(2);
  });

  it('slides the TTL of a tool with slideWindow: true', async () => {
    await expect(runsAfterAHitAndTheFirstTtl('sliding_ttl')).resolves.toBe(1);
  });

  it('slides the plugin default TTL for slideWindow: true without a ttl', async () => {
    await expect(runsAfterAHitAndTheFirstTtl('sliding_default_ttl')).resolves.toBe(1);
  });

  it('serves the entry while its TTL lasts', async () => {
    await server.callTool('plugin_defaults', {}, caller);
    now += 9_000;
    const hit = await server.callTool('plugin_defaults', {}, caller);

    expect(hit.structuredContent).toEqual({ runs: 1 });
    expect(hit._meta?.['cache']).toBe('hit');
  });
});
