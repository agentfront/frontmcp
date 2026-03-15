/**
 * Integration tests for class-based ESM tool registration.
 *
 * Verifies that real @Tool-decorated classes (using Symbol tokens from FrontMcpToolTokens)
 * are detected by isDecoratedToolClass() and can be normalized via normalizeTool()
 * into ToolClassTokenRecords — the same path used by local tools.
 */
import 'reflect-metadata';
import { FrontMcpToolTokens, FrontMcpResourceTokens, FrontMcpPromptTokens, ToolKind } from '../../common';
import {
  isDecoratedToolClass,
  isDecoratedResourceClass,
  isDecoratedPromptClass,
  normalizeToolFromEsmExport,
  normalizeResourceFromEsmExport,
  normalizePromptFromEsmExport,
} from '../../app/instances/esm-normalize.utils';
import { normalizeTool, collectToolMetadata } from '../../tool/tool.utils';
import { extendedToolMetadata } from '../../common/tokens';

/**
 * Helper: simulate what @Tool decorator does — store metadata using real Symbol tokens.
 */
function simulateToolDecorator(
  cls: { new (...args: unknown[]): unknown },
  meta: { name: string; description?: string; inputSchema?: Record<string, unknown> },
) {
  Reflect.defineMetadata(FrontMcpToolTokens.type, true, cls);
  Reflect.defineMetadata(FrontMcpToolTokens.name, meta.name, cls);
  if (meta.description) {
    Reflect.defineMetadata(FrontMcpToolTokens.description, meta.description, cls);
  }
  if (meta.inputSchema) {
    Reflect.defineMetadata(FrontMcpToolTokens.inputSchema, meta.inputSchema, cls);
  }
  Reflect.defineMetadata(extendedToolMetadata, {}, cls);
}

describe('ESM Class-Based Registration', () => {
  describe('Detection: decorated classes vs plain objects', () => {
    it('detects @Tool-decorated class with Symbol tokens', () => {
      class MyTool {
        async execute() {
          return { content: [] };
        }
      }
      simulateToolDecorator(MyTool, { name: 'my-tool', description: 'A tool' });

      expect(isDecoratedToolClass(MyTool)).toBe(true);
      // Plain-object normalizer should NOT handle it
      expect(normalizeToolFromEsmExport(MyTool)).toBeUndefined();
    });

    it('does not detect plain objects as decorated classes', () => {
      const plainTool = { name: 'echo', execute: jest.fn() };
      expect(isDecoratedToolClass(plainTool)).toBe(false);
      // Plain-object normalizer should handle it
      expect(normalizeToolFromEsmExport(plainTool)).toBeDefined();
    });

    it('does not detect undecorated classes as decorated', () => {
      class UndecoratedTool {
        async execute() {
          return { content: [] };
        }
      }
      expect(isDecoratedToolClass(UndecoratedTool)).toBe(false);
    });
  });

  describe('normalizeTool() with decorated classes', () => {
    it('produces CLASS_TOKEN record from @Tool-decorated class', () => {
      class EchoTool {
        async execute(input: { message: string }) {
          return { content: [{ type: 'text' as const, text: input.message }] };
        }
      }
      simulateToolDecorator(EchoTool, {
        name: 'echo',
        description: 'Echoes input',
        inputSchema: { message: { type: 'string' } },
      });

      const record = normalizeTool(EchoTool);

      expect(record.kind).toBe(ToolKind.CLASS_TOKEN);
      expect(record.metadata.name).toBe('echo');
      expect(record.metadata.description).toBe('Echoes input');
      expect(record.provide).toBe(EchoTool);
    });

    it('extracts metadata via collectToolMetadata using Symbol tokens', () => {
      class AddTool {
        async execute() {
          return { content: [] };
        }
      }
      simulateToolDecorator(AddTool, {
        name: 'add',
        description: 'Adds numbers',
        inputSchema: { a: { type: 'number' }, b: { type: 'number' } },
      });

      const metadata = collectToolMetadata(AddTool);
      expect(metadata.name).toBe('add');
      expect(metadata.description).toBe('Adds numbers');
      expect(metadata.inputSchema).toEqual({ a: { type: 'number' }, b: { type: 'number' } });
    });
  });

  describe('Namespace prefixing for class tools', () => {
    it('record metadata can be prefixed with namespace', () => {
      class ForgetTool {
        async execute() {
          return { content: [] };
        }
      }
      simulateToolDecorator(ForgetTool, { name: 'forget', description: 'Forgets' });

      const record = normalizeTool(ForgetTool);
      const namespace = 'acme';
      const prefixedName = `${namespace}:${record.metadata.name}`;
      record.metadata.name = prefixedName;
      record.metadata.id = prefixedName;

      expect(record.metadata.name).toBe('acme:forget');
      expect(record.metadata.id).toBe('acme:forget');
    });
  });

  describe('Mixed manifest: plain objects + decorated classes', () => {
    it('detection correctly separates both types', () => {
      class DecoratedTool {
        async execute() {
          return { content: [] };
        }
      }
      simulateToolDecorator(DecoratedTool, { name: 'decorated' });

      const plainTool = { name: 'plain', execute: jest.fn() };

      const items: unknown[] = [DecoratedTool, plainTool];

      const decorated = items.filter(isDecoratedToolClass);
      const plain = items.filter((i) => !isDecoratedToolClass(i));

      expect(decorated).toHaveLength(1);
      expect(plain).toHaveLength(1);

      // Decorated goes through normalizeTool
      const record = normalizeTool(decorated[0]);
      expect(record.kind).toBe(ToolKind.CLASS_TOKEN);
      expect(record.metadata.name).toBe('decorated');

      // Plain goes through normalizeToolFromEsmExport
      const def = normalizeToolFromEsmExport(plain[0]);
      expect(def).toBeDefined();
      expect(def?.name).toBe('plain');
    });
  });

  describe('Resource and Prompt detection', () => {
    it('detects @Resource-decorated class', () => {
      class StatusResource {}
      Reflect.defineMetadata(FrontMcpResourceTokens.type, true, StatusResource);
      expect(isDecoratedResourceClass(StatusResource)).toBe(true);
      expect(normalizeResourceFromEsmExport(StatusResource)).toBeUndefined();
    });

    it('detects @Prompt-decorated class', () => {
      class GreetPrompt {}
      Reflect.defineMetadata(FrontMcpPromptTokens.type, true, GreetPrompt);
      expect(isDecoratedPromptClass(GreetPrompt)).toBe(true);
      expect(normalizePromptFromEsmExport(GreetPrompt)).toBeUndefined();
    });
  });
});
