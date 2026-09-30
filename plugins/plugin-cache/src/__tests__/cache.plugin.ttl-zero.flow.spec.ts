/**
 * `cache: { ttl: 0 }` turns caching off for a tool (#647).
 *
 * Any cache object counted as "cache this", and a TTL of 0 means an entry that never expires, so
 * a tool that asked not to be cached had its first result served forever. CodeCall's
 * `codecall:execute` and `codecall:invoke` set `ttl: 0` for exactly that reason: the second run
 * of a script returned the first run's result.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));

let executions = 0;

@Tool({ name: 'run_script', description: 'Runs a script', inputSchema: {}, cache: { ttl: 0 } })
class RunScriptTool extends ToolContext {
  async execute() {
    executions += 1;
    return { run: executions };
  }
}

@Tool({ name: 'report:now', description: 'A report matched by a pattern', inputSchema: {}, cache: { ttl: 0 } })
class ReportNowTool extends ToolContext {
  async execute() {
    executions += 1;
    return { run: executions };
  }
}

@App({
  id: 'scripts',
  name: 'Scripts',
  plugins: [CachePlugin.init({ type: 'memory', toolPatterns: ['report:*'] })],
  tools: [RunScriptTool, ReportNowTool],
})
class ScriptsApp {}

describe('CachePlugin — cache: { ttl: 0 } (#647)', () => {
  let server: DirectMcpServer;
  const caller = { authContext: { sessionId: 'session-scripts', user: { sub: 'scripts-caller' } } };

  beforeEach(async () => {
    executions = 0;
    server = await FrontMcpInstance.createDirect({
      info: { name: 'cache-ttl-zero', version: '1.0.0' },
      apps: [ScriptsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('runs the tool on every call', async () => {
    const first = await server.callTool('run_script', {}, caller);
    const second = await server.callTool('run_script', {}, caller);

    expect(executions).toBe(2);
    expect(second.structuredContent).toEqual({ run: 2 });
    expect(second._meta?.['cache']).toBeUndefined();
    expect(first.structuredContent).toEqual({ run: 1 });
  });

  it('wins over a tool pattern that would cache the tool', async () => {
    await server.callTool('report:now', {}, caller);
    const second = await server.callTool('report:now', {}, caller);

    expect(executions).toBe(2);
    expect(second.structuredContent).toEqual({ run: 2 });
  });
});
