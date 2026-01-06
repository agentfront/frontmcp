// file: libs/plugins/src/codecall/__tests__/codecall-config.provider.test.ts

import { BaseConfig } from '@frontmcp/sdk';
import { codeCallPluginOptionsSchema, CodeCallPluginOptions, CodeCallPluginOptionsInput } from '../codecall.types';

// Create a test implementation that extends BaseConfig (without decorator for testing)
class CodeCallConfigProvider extends BaseConfig<CodeCallPluginOptions> {
  constructor(options: CodeCallPluginOptionsInput = {}) {
    const parsedConfig = codeCallPluginOptionsSchema.parse(options);
    super(parsedConfig);
  }
}

describe('CodeCallConfigProvider', () => {
  describe('initialization', () => {
    it('should initialize with default values when no options provided', () => {
      const provider = new CodeCallConfigProvider();

      expect(provider.get('mode')).toBe('codecall_only');
      expect(provider.get('topK')).toBe(8);
      expect(provider.get('maxDefinitions')).toBe(8);
      expect(provider.get('vm.preset')).toBe('secure');
      expect(provider.get('embedding.strategy')).toBe('tfidf');
      expect(provider.get('embedding.modelName')).toBe('Xenova/all-MiniLM-L6-v2');
      expect(provider.get('embedding.cacheDir')).toBe('./.cache/transformers');
      expect(provider.get('embedding.useHNSW')).toBe(false);
    });

    it('should initialize with custom options', () => {
      const provider = new CodeCallConfigProvider({
        mode: 'codecall_opt_in',
        topK: 15,
        maxDefinitions: 20,
        vm: {
          preset: 'balanced',
          timeoutMs: 5000,
          allowLoops: true,
        },
        embedding: {
          strategy: 'ml',
          modelName: 'custom/model',
          cacheDir: './.cache/transformers',
          useHNSW: false,
        },
      });

      expect(provider.get('mode')).toBe('codecall_opt_in');
      expect(provider.get('topK')).toBe(15);
      expect(provider.get('maxDefinitions')).toBe(20);
      expect(provider.get('vm.preset')).toBe('balanced');
      expect(provider.get('vm.timeoutMs')).toBe(5000);
      expect(provider.get('vm.allowLoops')).toBe(true);
      expect(provider.get('embedding.strategy')).toBe('ml');
      expect(provider.get('embedding.modelName')).toBe('custom/model');
      expect(provider.get('embedding.cacheDir')).toBe('./.cache/transformers'); // default
      expect(provider.get('embedding.useHNSW')).toBe(false); // default
    });

    it('should throw error for invalid options', () => {
      expect(() => {
        new CodeCallConfigProvider({
          mode: 'invalid_mode' as any,
        });
      }).toThrow();
    });
  });

  describe('section access', () => {
    let provider: CodeCallConfigProvider;

    beforeEach(() => {
      provider = new CodeCallConfigProvider({
        mode: 'metadata_driven',
        topK: 10,
        maxDefinitions: 15,
        vm: {
          preset: 'experimental',
          timeoutMs: 10000,
        },
        embedding: {
          strategy: 'ml',
          modelName: 'Xenova/all-MiniLM-L6-v2',
          cacheDir: './.cache/transformers',
          useHNSW: true,
        },
      });
    });

    it('should return mode with get()', () => {
      expect(provider.get('mode')).toBe('metadata_driven');
    });

    it('should return topK with get()', () => {
      expect(provider.get('topK')).toBe(10);
    });

    it('should return maxDefinitions with get()', () => {
      expect(provider.get('maxDefinitions')).toBe(15);
    });

    it('should return VM options with getSection()', () => {
      const vmOptions = provider.getSection('vm');
      expect(vmOptions.preset).toBe('experimental');
      expect(vmOptions.timeoutMs).toBe(10000);
    });

    it('should return embedding options with getSection()', () => {
      const embeddingOptions = provider.getSection('embedding');
      expect(embeddingOptions.strategy).toBe('ml');
      expect(embeddingOptions.useHNSW).toBe(true);
      expect(embeddingOptions.modelName).toBe('Xenova/all-MiniLM-L6-v2'); // default
      expect(embeddingOptions.cacheDir).toBe('./.cache/transformers'); // default
    });

    it('should return undefined for directCalls when not set', () => {
      const directCalls = provider.get('directCalls');
      expect(directCalls).toBeUndefined();
    });

    it('should return undefined for includeTools when not set', () => {
      const filter = provider.get('includeTools');
      expect(filter).toBeUndefined();
    });
  });

  describe('directCalls configuration', () => {
    it('should handle directCalls configuration', () => {
      const provider = new CodeCallConfigProvider({
        directCalls: {
          enabled: true,
          allowedTools: ['tool1', 'tool2'],
        },
      });

      const directCalls = provider.getSection('directCalls');
      expect(directCalls).toBeDefined();
      expect(directCalls?.enabled).toBe(true);
      expect(directCalls?.allowedTools).toEqual(['tool1', 'tool2']);
    });

    it('should handle directCalls with filter function', () => {
      const filterFn = (tool: { name: string }) => tool.name.startsWith('test:');

      const provider = new CodeCallConfigProvider({
        directCalls: {
          enabled: true,
          filter: filterFn,
        },
      });

      const directCalls = provider.getSection('directCalls');
      expect(directCalls).toBeDefined();
      expect(typeof directCalls?.filter).toBe('function');
    });
  });

  describe('includeTools configuration', () => {
    it('should handle includeTools filter', () => {
      const filterFn = (tool: { name: string; tags?: string[] }) => tool.tags?.includes('production') || false;

      const provider = new CodeCallConfigProvider({
        includeTools: filterFn,
      });

      const filter = provider.get('includeTools');
      expect(typeof filter).toBe('function');
    });
  });

  describe('reference consistency', () => {
    it('should return the same config object on multiple calls', () => {
      const provider = new CodeCallConfigProvider({
        mode: 'codecall_opt_in',
        topK: 12,
      });

      const config1 = provider.getAll();
      const config2 = provider.getAll();

      expect(config1).toBe(config2);
    });
  });

  describe('convict-like API - dotted path access', () => {
    let provider: CodeCallConfigProvider;

    beforeEach(() => {
      provider = new CodeCallConfigProvider({
        mode: 'metadata_driven',
        topK: 15,
        maxDefinitions: 20,
        vm: {
          preset: 'balanced',
          timeoutMs: 5000,
          allowLoops: true,
        },
        embedding: {
          strategy: 'ml',
          modelName: 'custom/model',
          cacheDir: './.cache/transformers',
          useHNSW: true,
        },
        directCalls: {
          enabled: true,
          allowedTools: ['tool1', 'tool2'],
        },
      });
    });

    it('should get top-level values with get()', () => {
      expect(provider.get('mode')).toBe('metadata_driven');
      expect(provider.get('topK')).toBe(15);
      expect(provider.get('maxDefinitions')).toBe(20);
    });

    it('should get nested values with dotted path', () => {
      expect(provider.get('vm.preset')).toBe('balanced');
      expect(provider.get('vm.timeoutMs')).toBe(5000);
      expect(provider.get('vm.allowLoops')).toBe(true);
      expect(provider.get('embedding.strategy')).toBe('ml');
      expect(provider.get('embedding.modelName')).toBe('custom/model');
      expect(provider.get('embedding.useHNSW')).toBe(true);
    });

    it('should get deeply nested values', () => {
      const directCalls = provider.get('directCalls');
      expect(directCalls?.enabled).toBe(true);
      expect(directCalls?.allowedTools).toEqual(['tool1', 'tool2']);
    });

    it('should check if path exists with has()', () => {
      expect(provider.has('mode')).toBe(true);
      expect(provider.has('vm.preset')).toBe(true);
      expect(provider.has('embedding.strategy')).toBe(true);
      expect(provider.has('nonexistent.path')).toBe(false);
    });

    it('should get values with defaults using get(path, default)', () => {
      expect(provider.get('topK', 100)).toBe(15);
      expect(provider.get('vm.timeoutMs', 1000)).toBe(5000);
      // Test with non-existent path
      expect(provider.get('nonexistent' as any, 'default')).toBe('default');
      expect(provider.get('vm.nonexistent' as any, 9999)).toBe(9999);
    });

    it('should get values with defaults using getOrDefault()', () => {
      expect(provider.getOrDefault('topK', 100)).toBe(15);
      expect(provider.getOrDefault('vm.timeoutMs', 1000)).toBe(5000);
      // Test with non-existent path
      expect(provider.getOrDefault('nonexistent' as any, 'default')).toBe('default');
    });

    it('should get required values with getRequired()', () => {
      expect(provider.getRequired('mode')).toBe('metadata_driven');
      expect(provider.getRequired('vm.preset')).toBe('balanced');

      // Should throw for undefined
      expect(() => {
        provider.getRequired('nonexistent' as any);
      }).toThrow('Required configuration path "nonexistent" is undefined');
    });

    it('should get required values with getOrThrow()', () => {
      expect(provider.getOrThrow('mode')).toBe('metadata_driven');
      expect(provider.getOrThrow('vm.preset')).toBe('balanced');
      expect(provider.getOrThrow('embedding.strategy')).toBe('ml');

      // Should throw for undefined
      expect(() => {
        provider.getOrThrow('nonexistent' as any);
      }).toThrow('Required configuration path "nonexistent" is undefined');
    });

    it('should get entire sections with getSection()', () => {
      const vmSection = provider.getSection('vm');
      expect(vmSection.preset).toBe('balanced');
      expect(vmSection.timeoutMs).toBe(5000);
      expect(vmSection.allowLoops).toBe(true);

      const embeddingSection = provider.getSection('embedding');
      expect(embeddingSection.strategy).toBe('ml');
      expect(embeddingSection.modelName).toBe('custom/model');
    });

    it('should match values with matches()', () => {
      expect(provider.matches('mode', 'metadata_driven')).toBe(true);
      expect(provider.matches('mode', 'codecall_only')).toBe(false);
      expect(provider.matches('vm.preset', 'balanced')).toBe(true);
      expect(provider.matches('vm.preset', 'secure')).toBe(false);
    });

    it('should get multiple values with getMany()', () => {
      const values = provider.getMany(['mode', 'topK', 'vm.preset', 'embedding.strategy']);
      expect(values.mode).toBe('metadata_driven');
      expect(values.topK).toBe(15);
      expect(values['vm.preset']).toBe('balanced');
      expect(values['embedding.strategy']).toBe('ml');
    });

    it('should convert to JSON', () => {
      const json = provider.toJSON();
      expect(json.mode).toBe('metadata_driven');
      expect(json.topK).toBe(15);
      expect(json.vm.preset).toBe('balanced');
    });

    it('should convert to string', () => {
      const str = provider.toString();
      expect(str).toContain('"mode": "metadata_driven"');
      expect(str).toContain('"topK": 15');
      expect(typeof str).toBe('string');
    });
  });
});
