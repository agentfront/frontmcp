/**
 * `plugins: [RememberPlugin]`, the class without `init()`, works with the default options (#803).
 *
 * A plugin listed as its class got none of the providers its `static dynamicProviders` derives from
 * its options, so `this.remember` had no accessor and the first tool that used it failed with
 * "RememberPlugin is not installed".
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import { RememberAccessorToken } from '../remember.symbols';

@Tool({ name: 'note', inputSchema: { text: z.string().optional() } })
class NoteTool extends ToolContext {
  async execute(input: { text?: string }) {
    const remember = this.get(RememberAccessorToken);
    if (input.text !== undefined) await remember.set('note', input.text, { scope: 'global' });
    return { note: (await remember.get<string>('note', { scope: 'global' })) ?? null };
  }
}

@App({ id: 'notes', name: 'Notes', plugins: [RememberPlugin], tools: [NoteTool] })
class NotesApp {}

describe('plugins: [RememberPlugin] without init() (#803)', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'remember-class-form', version: '1.0.0' },
      apps: [NotesApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('stores and recalls through the default in-memory store', async () => {
    const stored = await server.callTool('note', { text: 'buy milk' });
    expect(stored.isError).toBeFalsy();
    expect(stored.structuredContent).toEqual({ note: 'buy milk' });

    const recalled = await server.callTool('note', {});
    expect(recalled.structuredContent).toEqual({ note: 'buy milk' });
  });

  it('installs no memory tools, as init() without tools.enabled does', async () => {
    const names = (await server.listTools()).tools.map((tool) => tool.name);

    expect(names).toEqual(['note']);
  });
});
