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

  describe('expiry (#717)', () => {
    it('reports the defaultTTL deadline from remember_this, and recall reports the same one', async () => {
      client = await connect(serverWith({ tools: { enabled: true }, defaultTTL: 60 }));
      const before = Date.now();

      const stored = structured(await client.callTool('remember_this', { key: 'colour', value: 'green' }));
      const after = Date.now();

      expect(stored['expiresAt']).toBeGreaterThanOrEqual(before + 60_000);
      expect(stored['expiresAt']).toBeLessThanOrEqual(after + 60_000);
      expect(structured(await client.callTool('recall', { key: 'colour' }))['expiresAt']).toBe(stored['expiresAt']);
    });

    it('reports the deadline of an explicit ttl, the same one recall reports', async () => {
      client = await connect(serverWith({ tools: { enabled: true }, defaultTTL: 60 }));
      const before = Date.now();

      const stored = structured(await client.callTool('remember_this', { key: 'colour', value: 'green', ttl: 5 }));

      expect(stored['expiresAt']).toBeGreaterThanOrEqual(before + 5_000);
      expect(stored['expiresAt']).toBeLessThanOrEqual(Date.now() + 5_000);
      expect(structured(await client.callTool('recall', { key: 'colour' }))['expiresAt']).toBe(stored['expiresAt']);
    });

    it('reports no expiry without defaultTTL or a ttl', async () => {
      client = await connect(serverWith({ tools: { enabled: true } }));

      const stored = structured(await client.callTool('remember_this', { key: 'colour', value: 'green' }));

      expect(stored['expiresAt']).toBeUndefined();
      expect(structured(await client.callTool('recall', { key: 'colour' }))['expiresAt']).toBeUndefined();
    });
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

  describe('options from `init({ inject, useFactory })` (#678)', () => {
    function factoryServerWith(options: RememberPluginOptionsInput) {
      @App({
        id: 'llm-memory-factory',
        name: 'LLM memory (factory)',
        plugins: [
          RememberPlugin.init({
            inject: () => [] as const,
            useFactory: () => ({ type: 'memory', skipLegacyPurge: true, ...options }) as RememberPluginOptionsInput,
          }),
        ],
      })
      class MemoryFactoryApp {}

      return {
        info: { name: 'remember-llm-tools-factory', version: '1.0.0' },
        apps: [MemoryFactoryApp],
        logging: { level: LogLevel.Off },
      };
    }

    it('exposes the four memory tools when the factory enables them', async () => {
      client = await connect(factoryServerWith({ tools: { enabled: true } }));

      expect(await toolNames(client)).toEqual(MEMORY_TOOLS);
    });

    it('names them with the prefix the factory returns', async () => {
      client = await connect(factoryServerWith({ tools: { enabled: true, prefix: 'memory_' } }));

      expect(await toolNames(client)).toEqual(MEMORY_TOOLS.map((n) => `memory_${n}`).sort());
    });

    it('works end to end and applies the allowed scopes the factory returns', async () => {
      client = await connect(factoryServerWith({ tools: { enabled: true, allowedScopes: ['session'] } }));

      await client.callTool('remember_this', { key: 'colour', value: 'blue' });

      expect(structured(await client.callTool('recall', { key: 'colour' }))).toMatchObject({
        found: true,
        value: 'blue',
      });
      const refused = await client.callTool('remember_this', { key: 'k', value: 'v', scope: 'global' });
      expect((refused as { isError?: boolean }).isError).toBe(true);
    });

    it('exposes no memory tools when the factory does not enable them', async () => {
      client = await connect(factoryServerWith({}));

      expect(await toolNames(client)).toEqual([]);
    });
  });
});
