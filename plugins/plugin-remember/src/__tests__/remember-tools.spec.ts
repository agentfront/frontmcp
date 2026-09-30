// file: plugins/plugin-remember/src/__tests__/remember-tools.spec.ts

import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { App, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import { ForgetTool, ListMemoriesTool, RecallTool, RememberThisTool } from '../tools';
import { forgetInputSchema, forgetOutputSchema } from '../tools/forget.tool';
import { listMemoriesInputSchema, listMemoriesOutputSchema } from '../tools/list-memories.tool';
import { recallInputSchema, recallOutputSchema } from '../tools/recall.tool';
import { rememberThisInputSchema, rememberThisOutputSchema } from '../tools/remember-this.tool';

@App({
  id: 'memory',
  name: 'Memory',
  plugins: [RememberPlugin.init({ type: 'memory', skipLegacyPurge: true })],
  tools: [RememberThisTool, RecallTool, ForgetTool, ListMemoriesTool],
})
class MemoryApp {}

interface ListedTool {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, { description?: string }> };
}

async function listRememberTools(): Promise<ListedTool[]> {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'remember-tool-descriptions', version: '1.0.0' },
    apps: [MemoryApp],
    logging: { level: LogLevel.Off },
  });
  try {
    return (await server.listTools()).tools as ListedTool[];
  } finally {
    await server.dispose();
  }
}

describe('Remember Tools', () => {
  describe('RememberThisTool', () => {
    describe('schema validation', () => {
      const rememberThisSchema = z.object(rememberThisInputSchema);
      it('should validate valid input', () => {
        const input = { key: 'test_key', value: 'test_value' };
        const result = rememberThisSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should require non-empty key', () => {
        const input = { key: '', value: 'test' };
        const result = rememberThisSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should accept any JSON value', () => {
        const inputs = [
          { key: 'k', value: 'string' },
          { key: 'k', value: 123 },
          { key: 'k', value: { nested: true } },
          { key: 'k', value: [1, 2, 3] },
          { key: 'k', value: null },
        ];
        inputs.forEach((input) => {
          const result = rememberThisSchema.safeParse(input);
          expect(result.success).toBe(true);
        });
      });

      it('should accept valid scope values', () => {
        const scopes = ['session', 'user', 'tool', 'global'];
        scopes.forEach((scope) => {
          const result = rememberThisSchema.safeParse({ key: 'k', value: 'v', scope });
          expect(result.success).toBe(true);
        });
      });

      it('should reject invalid scope', () => {
        const result = rememberThisSchema.safeParse({ key: 'k', value: 'v', scope: 'invalid' });
        expect(result.success).toBe(false);
      });

      it('should accept positive ttl', () => {
        const result = rememberThisSchema.safeParse({ key: 'k', value: 'v', ttl: 3600 });
        expect(result.success).toBe(true);
      });

      it('should reject non-positive ttl', () => {
        expect(rememberThisSchema.safeParse({ key: 'k', value: 'v', ttl: 0 }).success).toBe(false);
        expect(rememberThisSchema.safeParse({ key: 'k', value: 'v', ttl: -1 }).success).toBe(false);
      });

      it('should accept valid brand values', () => {
        const brands = ['preference', 'cache', 'state', 'conversation', 'custom'];
        brands.forEach((brand) => {
          const result = rememberThisSchema.safeParse({ key: 'k', value: 'v', brand });
          expect(result.success).toBe(true);
        });
      });

      it('should validate output schema', () => {
        const output = { success: true, key: 'test', scope: 'session' };
        const result = rememberThisOutputSchema.safeParse(output);
        expect(result.success).toBe(true);
      });

      it('should validate output with expiresAt', () => {
        const output = { success: true, key: 'test', scope: 'session', expiresAt: Date.now() + 3600000 };
        const result = rememberThisOutputSchema.safeParse(output);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('RecallTool', () => {
    describe('schema validation', () => {
      it('should validate valid input', () => {
        const result = recallInputSchema.key.safeParse('test_key');
        expect(result.success).toBe(true);
      });

      it('should require non-empty key', () => {
        const result = recallInputSchema.key.safeParse('');
        expect(result.success).toBe(false);
      });

      it('should validate output when found', () => {
        const output = {
          found: true,
          key: 'test',
          value: 'data',
          scope: 'session',
          createdAt: Date.now(),
        };
        const result = recallOutputSchema.safeParse(output);
        expect(result.success).toBe(true);
      });

      it('should validate output when not found', () => {
        const output = { found: false, key: 'test', scope: 'session' };
        const result = recallOutputSchema.safeParse(output);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('ForgetTool', () => {
    describe('schema validation', () => {
      const forgetSchema = z.object(forgetInputSchema);

      it('should validate valid input', () => {
        const result = forgetSchema.safeParse({ key: 'test_key' });
        expect(result.success).toBe(true);
      });

      it('should require non-empty key', () => {
        const result = forgetSchema.safeParse({ key: '' });
        expect(result.success).toBe(false);
      });

      it('should accept valid scope', () => {
        const result = forgetSchema.safeParse({ key: 'k', scope: 'user' });
        expect(result.success).toBe(true);
      });

      it('should validate output', () => {
        const output = { success: true, key: 'test', scope: 'session', existed: true };
        const result = forgetOutputSchema.safeParse(output);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('ListMemoriesTool', () => {
    describe('schema validation', () => {
      const listMemoriesSchema = z.object(listMemoriesInputSchema);

      it('should validate empty input', () => {
        const result = listMemoriesSchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it('should accept valid scope', () => {
        const result = listMemoriesSchema.safeParse({ scope: 'user' });
        expect(result.success).toBe(true);
      });

      it('should accept pattern', () => {
        const result = listMemoriesSchema.safeParse({ pattern: 'user_*' });
        expect(result.success).toBe(true);
      });

      it('should accept valid limit', () => {
        const result = listMemoriesSchema.safeParse({ limit: 25 });
        expect(result.success).toBe(true);
      });

      it('should reject limit over 100', () => {
        const result = listMemoriesSchema.safeParse({ limit: 101 });
        expect(result.success).toBe(false);
      });

      it('should reject non-positive limit', () => {
        expect(listMemoriesSchema.safeParse({ limit: 0 }).success).toBe(false);
        expect(listMemoriesSchema.safeParse({ limit: -1 }).success).toBe(false);
      });

      it('should validate output', () => {
        const output = { keys: ['a', 'b'], scope: 'session', count: 2, truncated: false };
        const result = listMemoriesOutputSchema.safeParse(output);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('what the tools tell the model about scopes (#647)', () => {
    let tools: ListedTool[];

    beforeAll(async () => {
      tools = await listRememberTools();
    });

    function scopeDescriptions(): string[] {
      return tools.map((tool) => tool.inputSchema.properties?.['scope']?.description ?? '');
    }

    it('describes the scope argument of all four tools the same way', () => {
      const descriptions = scopeDescriptions();

      expect({ tools: tools.length, distinct: new Set(descriptions).size }).toEqual({ tools: 4, distinct: 1 });
    });

    it('promises no lifetime the scopes do not have', () => {
      const promises = scopeDescriptions().filter((text) => /until disconnect|forever/i.test(text));

      expect(promises).toEqual([]);
    });

    it('says what every scope means, and that an anonymous caller is refused', () => {
      const [description] = scopeDescriptions();

      expect(description).toEqual(expect.stringMatching(/session:.*user:.*tool:.*global:.*anonymous caller/s));
    });

    it('says that a caller without a session keeps session memory as the signed-in caller', () => {
      const [description] = scopeDescriptions();

      expect(description).toEqual(expect.stringContaining('MCP 2026-07-28'));
    });

    it('does not promise that remember_this reaches future conversations', () => {
      const rememberThis = tools.find((tool) => tool.name === 'remember_this');

      expect(rememberThis?.description).not.toMatch(/future conversations/i);
    });

    it('does not tell the model list_memories reads the session or the user', () => {
      const listMemories = tools.find((tool) => tool.name === 'list_memories');

      expect(listMemories?.description).not.toMatch(/current session or user/i);
    });
  });
});
