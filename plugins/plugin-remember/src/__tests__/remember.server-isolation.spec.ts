/**
 * Every server keeps its own in-memory Remember store, even when several servers in one process
 * are built from the same app and plugin record (#647).
 *
 * The memory store was created once, when `RememberPlugin.init()` ran (or when the plugin module
 * loaded, for the default store), so every server in the process shared it: a `global` value one
 * server stored was readable, and writable, on every other.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import { RememberAccessorToken } from '../remember.symbols';

/** Stores `motd` in global memory when given, and answers the one remembered. */
@Tool({ name: 'motd', inputSchema: { motd: z.string().optional() } })
class MotdTool extends ToolContext {
  async execute(input: { motd?: string }) {
    const remember = this.get(RememberAccessorToken);
    if (input.motd !== undefined) await remember.set('motd', input.motd, { scope: 'global' });
    return { motd: (await remember.get<string>('motd', { scope: 'global' })) ?? null };
  }
}

@App({
  id: 'board',
  name: 'Board',
  plugins: [RememberPlugin.init({ type: 'memory', skipLegacyPurge: true })],
  tools: [MotdTool],
})
class BoardApp {}

async function buildServer(): Promise<DirectMcpServer> {
  return FrontMcpInstance.createDirect({
    info: { name: 'remember-server-isolation', version: '1.0.0' },
    apps: [BoardApp],
    logging: { level: LogLevel.Off },
  });
}

async function motd(server: DirectMcpServer, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = await server.callTool('motd', args);
  return (result.structuredContent as { motd?: unknown } | undefined)?.motd;
}

describe('RememberPlugin — one memory store per server (#647)', () => {
  let first: DirectMcpServer;
  let second: DirectMcpServer;

  beforeEach(async () => {
    first = await buildServer();
    second = await buildServer();
  });

  afterEach(async () => {
    await first.dispose();
    await second.dispose();
  });

  it('does not show one server the global memory another server stored', async () => {
    await motd(first, { motd: 'hello from the first server' });

    await expect(motd(second)).resolves.toBeNull();
  });

  it('keeps each server its own global memory', async () => {
    await motd(first, { motd: 'first' });
    await motd(second, { motd: 'second' });

    expect([await motd(first), await motd(second)]).toEqual(['first', 'second']);
  });
});
