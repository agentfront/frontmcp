import 'reflect-metadata';
import {
  normalizeToolFromEsmExport,
  normalizeResourceFromEsmExport,
  normalizePromptFromEsmExport,
  isDecoratedToolClass,
  isDecoratedResourceClass,
  isDecoratedPromptClass,
} from '../../app/instances/esm-normalize.utils';
import { FrontMcpToolTokens, FrontMcpResourceTokens, FrontMcpPromptTokens } from '../../common/tokens';

describe('esm-normalize.utils', () => {
  // ═══════════════════════════════════════════════════════════════
  // DECORATED CLASS DETECTION
  // ═══════════════════════════════════════════════════════════════

  describe('isDecoratedToolClass()', () => {
    it('returns true for class with @Tool Symbol metadata', () => {
      class MyTool {
        async execute() {
          return { content: [] };
        }
      }
      Reflect.defineMetadata(FrontMcpToolTokens.type, true, MyTool);
      expect(isDecoratedToolClass(MyTool)).toBe(true);
    });

    it('returns false for class without @Tool metadata', () => {
      class PlainClass {}
      expect(isDecoratedToolClass(PlainClass)).toBe(false);
    });

    it('returns false for plain objects', () => {
      expect(isDecoratedToolClass({ name: 'tool', execute: jest.fn() })).toBe(false);
    });

    it('returns false for null/undefined/primitives', () => {
      expect(isDecoratedToolClass(null)).toBe(false);
      expect(isDecoratedToolClass(undefined)).toBe(false);
      expect(isDecoratedToolClass(42)).toBe(false);
      expect(isDecoratedToolClass('string')).toBe(false);
    });

    it('returns false for class with string-key metadata (not Symbol)', () => {
      class OldStyleTool {}
      Reflect.defineMetadata('frontmcp:tool:name', 'old', OldStyleTool);
      expect(isDecoratedToolClass(OldStyleTool)).toBe(false);
    });
  });

  describe('isDecoratedResourceClass()', () => {
    it('returns true for class with @Resource Symbol metadata', () => {
      class MyResource {}
      Reflect.defineMetadata(FrontMcpResourceTokens.type, true, MyResource);
      expect(isDecoratedResourceClass(MyResource)).toBe(true);
    });

    it('returns false for class without metadata', () => {
      class PlainClass {}
      expect(isDecoratedResourceClass(PlainClass)).toBe(false);
    });

    it('returns false for plain objects', () => {
      expect(isDecoratedResourceClass({ name: 'r', uri: 'x', read: jest.fn() })).toBe(false);
    });
  });

  describe('isDecoratedPromptClass()', () => {
    it('returns true for class with @Prompt Symbol metadata', () => {
      class MyPrompt {}
      Reflect.defineMetadata(FrontMcpPromptTokens.type, true, MyPrompt);
      expect(isDecoratedPromptClass(MyPrompt)).toBe(true);
    });

    it('returns false for class without metadata', () => {
      class PlainClass {}
      expect(isDecoratedPromptClass(PlainClass)).toBe(false);
    });

    it('returns false for plain objects', () => {
      expect(isDecoratedPromptClass({ name: 'p', execute: jest.fn() })).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PLAIN OBJECT NORMALIZATION
  // ═══════════════════════════════════════════════════════════════

  describe('normalizeToolFromEsmExport()', () => {
    it('normalizes plain object with execute function', () => {
      const executeFn = jest.fn().mockResolvedValue({ content: [] });
      const raw = {
        name: 'my-tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'string' },
        execute: executeFn,
      };

      const result = normalizeToolFromEsmExport(raw);

      expect(result).toBeDefined();
      expect(result!.name).toBe('my-tool');
      expect(result!.description).toBe('A test tool');
      expect(result!.inputSchema).toEqual({ type: 'object' });
      expect(result!.execute).toBe(executeFn);
    });

    it('normalizes plain object without optional fields', () => {
      const executeFn = jest.fn();
      const raw = { name: 'basic', execute: executeFn };

      const result = normalizeToolFromEsmExport(raw);

      expect(result).toBeDefined();
      expect(result!.name).toBe('basic');
      expect(result!.description).toBeUndefined();
      expect(result!.inputSchema).toBeUndefined();
    });

    it('returns undefined for decorated classes (handled by caller)', () => {
      class DecoratedTool {
        async execute() {
          return { content: [] };
        }
      }
      Reflect.defineMetadata(FrontMcpToolTokens.type, true, DecoratedTool);
      // Classes are not handled by normalizeToolFromEsmExport
      expect(normalizeToolFromEsmExport(DecoratedTool)).toBeUndefined();
    });

    it('returns undefined for undecorated classes', () => {
      class PlainClass {
        doSomething() {
          return 42;
        }
      }
      expect(normalizeToolFromEsmExport(PlainClass)).toBeUndefined();
    });

    it('returns undefined for null/undefined', () => {
      expect(normalizeToolFromEsmExport(null)).toBeUndefined();
      expect(normalizeToolFromEsmExport(undefined)).toBeUndefined();
    });

    it('returns undefined for object without execute', () => {
      expect(normalizeToolFromEsmExport({ name: 'no-execute' })).toBeUndefined();
    });

    it('returns undefined for object without name', () => {
      expect(normalizeToolFromEsmExport({ execute: jest.fn() })).toBeUndefined();
    });

    it('returns undefined for primitive values', () => {
      expect(normalizeToolFromEsmExport('string')).toBeUndefined();
      expect(normalizeToolFromEsmExport(42)).toBeUndefined();
      expect(normalizeToolFromEsmExport(true)).toBeUndefined();
    });
  });

  describe('normalizeResourceFromEsmExport()', () => {
    it('normalizes plain object with read function', () => {
      const readFn = jest.fn().mockResolvedValue({ contents: [] });
      const raw = {
        name: 'my-resource',
        description: 'A test resource',
        uri: 'file://test',
        mimeType: 'text/plain',
        read: readFn,
      };

      const result = normalizeResourceFromEsmExport(raw);

      expect(result).toBeDefined();
      expect(result!.name).toBe('my-resource');
      expect(result!.description).toBe('A test resource');
      expect(result!.uri).toBe('file://test');
      expect(result!.mimeType).toBe('text/plain');
      expect(result!.read).toBe(readFn);
    });

    it('returns undefined for object without read function', () => {
      expect(normalizeResourceFromEsmExport({ name: 'r', uri: 'x' })).toBeUndefined();
    });

    it('returns undefined for object without name', () => {
      expect(normalizeResourceFromEsmExport({ read: jest.fn(), uri: 'x' })).toBeUndefined();
    });

    it('returns undefined for object without uri', () => {
      expect(normalizeResourceFromEsmExport({ name: 'r', read: jest.fn() })).toBeUndefined();
    });

    it('returns undefined for null/undefined', () => {
      expect(normalizeResourceFromEsmExport(null)).toBeUndefined();
      expect(normalizeResourceFromEsmExport(undefined)).toBeUndefined();
    });

    it('returns undefined for decorated classes', () => {
      class DecoratedResource {}
      Reflect.defineMetadata(FrontMcpResourceTokens.type, true, DecoratedResource);
      expect(normalizeResourceFromEsmExport(DecoratedResource)).toBeUndefined();
    });
  });

  describe('normalizePromptFromEsmExport()', () => {
    it('normalizes plain object with execute function', () => {
      const executeFn = jest.fn().mockResolvedValue({ messages: [] });
      const raw = {
        name: 'my-prompt',
        description: 'A test prompt',
        arguments: [{ name: 'topic', description: 'Topic', required: true }],
        execute: executeFn,
      };

      const result = normalizePromptFromEsmExport(raw);

      expect(result).toBeDefined();
      expect(result!.name).toBe('my-prompt');
      expect(result!.description).toBe('A test prompt');
      expect(result!.arguments).toEqual([{ name: 'topic', description: 'Topic', required: true }]);
      expect(result!.execute).toBe(executeFn);
    });

    it('returns undefined for object without execute', () => {
      expect(normalizePromptFromEsmExport({ name: 'p' })).toBeUndefined();
    });

    it('returns undefined for object without name', () => {
      expect(normalizePromptFromEsmExport({ execute: jest.fn() })).toBeUndefined();
    });

    it('returns undefined for null/undefined', () => {
      expect(normalizePromptFromEsmExport(null)).toBeUndefined();
      expect(normalizePromptFromEsmExport(undefined)).toBeUndefined();
    });

    it('returns undefined for decorated classes', () => {
      class DecoratedPrompt {}
      Reflect.defineMetadata(FrontMcpPromptTokens.type, true, DecoratedPrompt);
      expect(normalizePromptFromEsmExport(DecoratedPrompt)).toBeUndefined();
    });
  });
});
