/**
 * Remember's memory belongs to the app that installs the plugin (#678).
 *
 * The SDK merged a plugin's providers into the scope's registry, so the tools of another app on
 * the same server — one without the plugin — resolved the Remember accessor too, and read and
 * wrote the first app's memory.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import { RememberAccessorToken } from '../remember.symbols';

/** Stores `note` in global memory when given, and answers the one remembered. */
@Tool({ name: 'board_note', inputSchema: { note: z.string().optional() } })
class BoardNoteTool extends ToolContext {
  async execute(input: { note?: string }) {
    const remember = this.get(RememberAccessorToken);
    if (input.note !== undefined) await remember.set('note', input.note, { scope: 'global' });
    return { note: (await remember.get<string>('note', { scope: 'global' })) ?? null };
  }
}

/** A tool of an app without the plugin: reports whether it can reach Remember at all. */
@Tool({ name: 'peek', inputSchema: {} })
class PeekTool extends ToolContext {
  async execute() {
    const remember = this.tryGet(RememberAccessorToken);
    if (!remember) return { reachable: false, note: null };
    return { reachable: true, note: (await remember.get<string>('note', { scope: 'global' })) ?? null };
  }
}

@App({
  id: 'board',
  name: 'Board',
  plugins: [RememberPlugin.init({ type: 'memory', skipLegacyPurge: true })],
  tools: [BoardNoteTool],
})
class BoardApp {}

@App({ id: 'other', name: 'Other', tools: [PeekTool] })
class OtherApp {}

describe('RememberPlugin — memory stays inside the app that installs it (#678)', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'remember-app-isolation', version: '1.0.0' },
      apps: [BoardApp, OtherApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it("keeps the installing app's memory working", async () => {
    await server.callTool('board_note', { note: 'ship it' });

    const result = await server.callTool('board_note', {});

    expect(result.structuredContent).toEqual({ note: 'ship it' });
  });

  it("does not let another app's tools reach that memory", async () => {
    await server.callTool('board_note', { note: 'ship it' });

    const result = await server.callTool('peek', {});

    expect(result.structuredContent).toEqual({ reachable: false, note: null });
  });
});
