// file: libs/plugins/src/codecall/__tests__/codecall-options.test.ts

import { codeCallPluginOptionsSchema, CodeCallPluginOptions } from '../codecall.types';

describe('CodeCallPluginOptions Zod Schema', () => {
  describe('default values', () => {
    it('should apply defaults for empty options', () => {
      const parsed = codeCallPluginOptionsSchema.parse({});

      expect(parsed.mode).toBe('codecall_only');
      expect(parsed.topK).toBe(8);
      expect(parsed.maxDefinitions).toBe(8);
      expect(parsed.vm.preset).toBe('secure');
      expect(parsed.embedding.strategy).toBe('tfidf');
      expect(parsed.embedding.modelName).toBe('Xenova/all-MiniLM-L6-v2');
      expect(parsed.embedding.cacheDir).toBe('./.cache/transformers');
      expect(parsed.embedding.useHNSW).toBe(false);
    });

    it('should preserve user-provided values and apply remaining defaults', () => {
      const parsed = codeCallPluginOptionsSchema.parse({
        mode: 'codecall_opt_in',
        topK: 15,
        vm: {
          preset: 'locked_down',
          timeoutMs: 1000,
        },
      });

      expect(parsed.mode).toBe('codecall_opt_in');
      expect(parsed.topK).toBe(15);
      expect(parsed.maxDefinitions).toBe(8); // default
      expect(parsed.vm.preset).toBe('locked_down');
      expect(parsed.vm.timeoutMs).toBe(1000);
      expect(parsed.embedding.strategy).toBe('tfidf'); // default
      expect(parsed.embedding.modelName).toBe('Xenova/all-MiniLM-L6-v2'); // default
    });

    it('should apply VM preset-specific defaults', () => {
      const parsedSecure = codeCallPluginOptionsSchema.parse({
        vm: { preset: 'secure' },
      });
      expect(parsedSecure.vm.preset).toBe('secure');

      const parsedBalanced = codeCallPluginOptionsSchema.parse({
        vm: { preset: 'balanced' },
      });
      expect(parsedBalanced.vm.preset).toBe('balanced');

      const parsedExperimental = codeCallPluginOptionsSchema.parse({
        vm: { preset: 'experimental' },
      });
      expect(parsedExperimental.vm.preset).toBe('experimental');

      const parsedLockedDown = codeCallPluginOptionsSchema.parse({
        vm: { preset: 'locked_down' },
      });
      expect(parsedLockedDown.vm.preset).toBe('locked_down');
    });
  });

  describe('validation', () => {
    it('should reject invalid mode', () => {
      expect(() => {
        codeCallPluginOptionsSchema.parse({
          mode: 'invalid_mode',
        });
      }).toThrow();
    });

    it('should reject invalid VM preset', () => {
      expect(() => {
        codeCallPluginOptionsSchema.parse({
          vm: { preset: 'invalid_preset' },
        });
      }).toThrow();
    });

    it('should reject negative topK', () => {
      expect(() => {
        codeCallPluginOptionsSchema.parse({
          topK: -5,
        });
      }).toThrow();
    });

    it('should reject zero topK', () => {
      expect(() => {
        codeCallPluginOptionsSchema.parse({
          topK: 0,
        });
      }).toThrow();
    });

    it('should accept valid custom options', () => {
      const parsed = codeCallPluginOptionsSchema.parse({
        mode: 'metadata_driven',
        topK: 10,
        maxDefinitions: 15,
        vm: {
          preset: 'balanced',
          timeoutMs: 5000,
          allowLoops: true,
          maxSteps: 10000,
          allowConsole: false,
          disabledBuiltins: ['eval'],
          disabledGlobals: ['process'],
        },
        embedding: {
          strategy: 'ml',
          modelName: 'custom/model',
          cacheDir: '/custom/cache',
          useHNSW: true,
        },
      });

      expect(parsed).toBeDefined();
      expect(parsed.mode).toBe('metadata_driven');
      expect(parsed.topK).toBe(10);
      expect(parsed.maxDefinitions).toBe(15);
      expect(parsed.vm.preset).toBe('balanced');
      expect(parsed.vm.timeoutMs).toBe(5000);
      expect(parsed.vm.allowLoops).toBe(true);
      expect(parsed.vm.maxSteps).toBe(10000);
      expect(parsed.vm.allowConsole).toBe(false);
      expect(parsed.vm.disabledBuiltins).toEqual(['eval']);
      expect(parsed.vm.disabledGlobals).toEqual(['process']);
      expect(parsed.embedding.strategy).toBe('ml');
      expect(parsed.embedding.modelName).toBe('custom/model');
      expect(parsed.embedding.cacheDir).toBe('/custom/cache');
      expect(parsed.embedding.useHNSW).toBe(true);
    });
  });

  describe('directCalls configuration', () => {
    it('should accept valid directCalls configuration', () => {
      const parsed = codeCallPluginOptionsSchema.parse({
        directCalls: {
          enabled: true,
          allowedTools: ['tool1', 'tool2'],
        },
      });

      expect(parsed.directCalls).toBeDefined();
      expect(parsed.directCalls?.enabled).toBe(true);
      expect(parsed.directCalls?.allowedTools).toEqual(['tool1', 'tool2']);
    });

    it('should handle directCalls with custom filter function', () => {
      const filterFn = (tool: { name: string }) => tool.name.startsWith('test:');

      const parsed = codeCallPluginOptionsSchema.parse({
        directCalls: {
          enabled: true,
          filter: filterFn,
        },
      });

      expect(parsed.directCalls).toBeDefined();
      expect(typeof parsed.directCalls?.filter).toBe('function');
      // Test that the function works correctly
      expect(parsed.directCalls?.filter?.({ name: 'test:tool', appId: 'app', source: 'src', tags: [] })).toBe(true);
      expect(parsed.directCalls?.filter?.({ name: 'other:tool', appId: 'app', source: 'src', tags: [] })).toBe(false);
    });
  });

  describe('includeTools configuration', () => {
    it('should accept includeTools filter function', () => {
      const includeFn = (tool: { name: string; tags?: string[] }) => tool.tags?.includes('production') || false;

      const parsed = codeCallPluginOptionsSchema.parse({
        includeTools: includeFn,
      });

      expect(typeof parsed.includeTools).toBe('function');
      // Test that the function works correctly
      expect(
        parsed.includeTools?.({
          name: 'tool1',
          appId: 'app',
          source: 'src',
          description: 'desc',
          tags: ['production'],
        }),
      ).toBe(true);
      expect(
        parsed.includeTools?.({ name: 'tool2', appId: 'app', source: 'src', description: 'desc', tags: ['dev'] }),
      ).toBe(false);
    });
  });
});
