/**
 * `RememberPlugin.init({ tools: { enabled: true } })` (#647).
 *
 * The documented option crashed startup (its `tools` object was read as the plugin's list of
 * tools) and, once that was fixed, registered nothing: the four memory tools, their `prefix` and
 * their `allowedScopes` were documented but never wired. They are the LLM's interface to memory, so
 * these run them through a real server and client.
 */
import 'reflect-metadata';

import { App, connect, LogLevel, type DirectClient } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import type { RememberPluginOptionsInput } from '../remember.types';

function serverWith(options: RememberPluginOptionsInput) {
  @App({
    id: 'llm-memory',
    name: 'LLM memory',
    plugins: [RememberPlugin.init({ type: 'memory', skipLegacyPurge: true, ...options })],
  })
  class MemoryApp {}

  return {
    info: { name: 'remember-llm-tools', version: '1.0.0' },
    apps: [MemoryApp],
    logging: { level: LogLevel.Off },
  };
}

const MEMORY_TOOLS = ['forget', 'list_memories', 'recall', 'remember_this'];

async function toolNames(client: DirectClient): Promise<string[]> {
  const tools = (await client.listTools()) as Array<{ name: string }>;
  return tools.map((t) => t.name).sort();
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
}

describe('RememberPlugin LLM tools', () => {
  let client: DirectClient | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('exposes no memory tools unless asked to', async () => {
    client = await connect(serverWith({}));

    expect(await toolNames(client)).toEqual([]);
  });

  it('exposes no memory tools when `tools.enabled` is false', async () => {
    client = await connect(serverWith({ tools: { enabled: false } }));

    expect(await toolNames(client)).toEqual([]);
  });

  it('starts with `tools: { enabled: true }` and exposes the four memory tools', async () => {
    client = await connect(serverWith({ tools: { enabled: true } }));

    expect(await toolNames(client)).toEqual(MEMORY_TOOLS);
  });

  it('stores and recalls through the tools', async () => {
    client = await connect(serverWith({ tools: { enabled: true } }));

    await client.callTool('remember_this', { key: 'colour', value: 'green' });

    expect(structured(await client.callTool('recall', { key: 'colour' }))).toMatchObject({
      found: true,
      value: 'green',
    });
    expect(structured(await client.callTool('list_memories', {}))['keys']).toEqual(['colour']);

    await client.callTool('forget', { key: 'colour' });

    expect(structured(await client.callTool('recall', { key: 'colour' }))).toMatchObject({ found: false });
  });

  describe('prefix', () => {
    it('names every tool with it', async () => {
      client = await connect(serverWith({ tools: { enabled: true, prefix: 'memory_' } }));

      expect(await toolNames(client)).toEqual(MEMORY_TOOLS.map((n) => `memory_${n}`).sort());
    });

    it('works end to end and points the model at the prefixed names', async () => {
      client = await connect(serverWith({ tools: { enabled: true, prefix: 'memory_' } }));

      await client.callTool('memory_remember_this', { key: 'pet', value: 'cat' });

      expect(structured(await client.callTool('memory_recall', { key: 'pet' }))).toMatchObject({
        found: true,
        value: 'cat',
      });
      const tools = (await client.listTools()) as Array<{ name: string; description?: string }>;
      const recall = tools.find((t) => t.name === 'memory_recall');
      expect(recall?.description).toContain('memory_remember_this');
      expect(recall?.description).not.toMatch(/(?<!memory_)remember_this/);
    });

    it('keeps each prefixed tool’s own `tool`-scope memory', async () => {
      client = await connect(serverWith({ tools: { enabled: true, prefix: 'm_' } }));

      await client.callTool('m_remember_this', { key: 'k', value: 'v', scope: 'tool' });

      expect(structured(await client.callTool('m_recall', { key: 'k', scope: 'tool' }))).toMatchObject({
        found: false,
      });
    });
  });

  describe('allowedScopes', () => {
    it('rejects a scope outside the list', async () => {
      client = await connect(serverWith({ tools: { enabled: true, allowedScopes: ['session'] } }));

      const result = await client.callTool('remember_this', { key: 'k', value: 'v', scope: 'global' });

      expect((result as { isError?: boolean }).isError).toBe(true);
    });

    it.each([
      ['remember_this', { key: 'k', value: 'v' }],
      ['recall', { key: 'k' }],
      ['forget', { key: 'k' }],
      ['list_memories', {}],
    ])('tells the model why %s was refused, in production too, when it omits the scope (#660)', async (tool, args) => {
      const nodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';

      try {
        client = await connect(serverWith({ tools: { enabled: true, allowedScopes: ['user'] } }));
        const result = (await client.callTool(tool, args)) as {
          isError?: boolean;
          content?: Array<{ text?: string }>;
        };

        const text = (result.content ?? []).map((c) => c.text ?? '').join(' ');
        expect(result.isError).toBe(true);
        expect(text).toContain("Scope 'session' is not allowed. Allowed scopes: user");
        expect(text).not.toContain('Internal FrontMCP error');
      } finally {
        if (nodeEnv === undefined) delete process.env['NODE_ENV'];
        else process.env['NODE_ENV'] = nodeEnv;
      }
    });

    it('allows a scope inside it', async () => {
      client = await connect(serverWith({ tools: { enabled: true, allowedScopes: ['session'] } }));

      const result = await client.callTool('remember_this', { key: 'k', value: 'v', scope: 'session' });

      expect((result as { isError?: boolean }).isError).toBeFalsy();
    });
  });
});
