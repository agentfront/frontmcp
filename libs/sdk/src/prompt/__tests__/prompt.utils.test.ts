import 'reflect-metadata';
import { normalizePrompt, collectPromptMetadata, buildParsedPromptResult, promptDiscoveryDeps } from '../prompt.utils';
import { Prompt, prompt } from '../../common/decorators/prompt.decorator';
import { PromptKind } from '../../common/records';

describe('prompt.utils', () => {
  describe('collectPromptMetadata', () => {
    it('should collect metadata from decorated class', () => {
      @Prompt({
        name: 'test-prompt',
        title: 'Test Title',
        description: 'Test description',
        arguments: [{ name: 'arg1', required: true }],
      })
      class TestPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const metadata = collectPromptMetadata(TestPrompt as any);
      expect(metadata.name).toBe('test-prompt');
      expect(metadata.title).toBe('Test Title');
      expect(metadata.description).toBe('Test description');
      expect(metadata.arguments).toHaveLength(1);
    });

    it('should collect minimal metadata', () => {
      @Prompt({
        name: 'minimal',
        arguments: [],
      })
      class MinimalPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const metadata = collectPromptMetadata(MinimalPrompt as any);
      expect(metadata.name).toBe('minimal');
    });

    it('should handle prompt with multiple arguments', () => {
      @Prompt({
        name: 'multi-arg',
        arguments: [
          { name: 'first', required: true },
          { name: 'second', required: false },
          { name: 'third', description: 'Third argument' },
        ],
      })
      class MultiArg {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const metadata = collectPromptMetadata(MultiArg as any);
      expect(metadata.arguments).toHaveLength(3);
    });
  });

  describe('normalizePrompt', () => {
    it('should normalize class-based prompt', () => {
      @Prompt({
        name: 'class-prompt',
        arguments: [],
      })
      class ClassPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const record = normalizePrompt(ClassPrompt);
      expect(record.kind).toBe(PromptKind.CLASS_TOKEN);
      expect(record.metadata.name).toBe('class-prompt');
      expect(record.provide).toBe(ClassPrompt);
    });

    it('should normalize function-based prompt', () => {
      const functionPrompt = prompt({
        name: 'function-prompt',
        arguments: [],
      })((args) => ({
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      }));

      const record = normalizePrompt(functionPrompt);
      expect(record.kind).toBe(PromptKind.FUNCTION);
      expect(record.metadata.name).toBe('function-prompt');
    });

    it('should throw for invalid input', () => {
      expect(() => normalizePrompt('invalid')).toThrow();
      expect(() => normalizePrompt(123)).toThrow();
      expect(() => normalizePrompt(null)).toThrow();
    });

    it('should preserve all metadata fields', () => {
      @Prompt({
        name: 'full-metadata',
        title: 'Full Title',
        description: 'Full Description',
        arguments: [{ name: 'arg', description: 'An argument', required: true }],
      })
      class FullMetadata {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const record = normalizePrompt(FullMetadata);
      expect(record.metadata.title).toBe('Full Title');
      expect(record.metadata.description).toBe('Full Description');
      expect(record.metadata.arguments?.[0].description).toBe('An argument');
    });
  });

  describe('buildParsedPromptResult', () => {
    const metadata = {
      name: 'test',
      description: 'Test prompt',
      arguments: [],
    };

    it('should pass through GetPromptResult format', () => {
      const input = {
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
        description: 'Custom description',
      };

      const result = buildParsedPromptResult(input, metadata);
      expect(result.messages).toHaveLength(1);
      expect(result.description).toBe('Custom description');
    });

    it('should use metadata description when not in raw', () => {
      const input = {
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      };

      const result = buildParsedPromptResult(input, metadata);
      expect(result.description).toBe('Test prompt');
    });

    it('should convert string to user message', () => {
      const result = buildParsedPromptResult('simple string', metadata);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect((result.messages[0].content as any).type).toBe('text');
      expect((result.messages[0].content as any).text).toBe('simple string');
    });

    it('should convert array to messages', () => {
      const input = [
        { role: 'user', content: { type: 'text', text: 'first' } },
        { role: 'assistant', content: { type: 'text', text: 'second' } },
      ];

      const result = buildParsedPromptResult(input, metadata);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
    });

    it('should normalize simple string messages in array', () => {
      const input = ['first message', 'second message'];

      const result = buildParsedPromptResult(input, metadata);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect((result.messages[0].content as any).text).toBe('first message');
    });

    it('should convert object to JSON user message', () => {
      const input = { key: 'value', number: 42 };

      const result = buildParsedPromptResult(input, metadata);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect((result.messages[0].content as any).text).toBe(JSON.stringify(input));
    });

    it('should handle null raw value', () => {
      const result = buildParsedPromptResult(null, metadata);
      expect(result.messages).toHaveLength(1);
      expect((result.messages[0].content as any).text).toBe('null');
    });

    it('should handle undefined raw value', () => {
      const result = buildParsedPromptResult(undefined, metadata);
      expect(result.messages).toHaveLength(1);
      // JSON.stringify(undefined) returns undefined (not a string), so the text is undefined
      expect((result.messages[0].content as { text: unknown }).text).toBeUndefined();
    });

    it('should handle number raw value', () => {
      const result = buildParsedPromptResult(42, metadata);
      expect(result.messages).toHaveLength(1);
      expect((result.messages[0].content as any).text).toBe('42');
    });

    it('should handle boolean raw value', () => {
      const result = buildParsedPromptResult(true, metadata);
      expect(result.messages).toHaveLength(1);
      expect((result.messages[0].content as any).text).toBe('true');
    });
  });

  describe('promptDiscoveryDeps', () => {
    it('should return empty array for class without dependencies', () => {
      @Prompt({
        name: 'no-deps',
        arguments: [],
      })
      class NoDeps {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const record = normalizePrompt(NoDeps);
      const deps = promptDiscoveryDeps(record);
      expect(deps).toEqual([]);
    });

    it('should return empty array for function prompt', () => {
      const functionPrompt = prompt({
        name: 'func-deps',
        arguments: [],
      })((args) => ({
        messages: [],
      }));

      const record = normalizePrompt(functionPrompt);
      const deps = promptDiscoveryDeps(record);
      expect(deps).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty arguments array', () => {
      @Prompt({
        name: 'empty-args',
        arguments: [],
      })
      class EmptyArgs {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const record = normalizePrompt(EmptyArgs);
      expect(record.metadata.arguments).toEqual([]);
    });

    it('should handle prompt with only name', () => {
      @Prompt({
        name: 'name-only',
        arguments: [],
      })
      class NameOnly {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const record = normalizePrompt(NameOnly);
      expect(record.metadata.name).toBe('name-only');
      expect(record.metadata.title).toBeUndefined();
      expect(record.metadata.description).toBeUndefined();
    });

    it('should handle complex message content in array', () => {
      const input = [
        { role: 'user', content: { type: 'text', text: 'text message' } },
        { role: 'assistant', content: { type: 'text', text: 'response' } },
      ];

      const metadata = { name: 'test', arguments: [] };
      const result = buildParsedPromptResult(input, metadata);
      expect(result.messages).toHaveLength(2);
    });

    it('should handle mixed array with objects and strings', () => {
      const input = ['simple string', { role: 'user', content: { type: 'text', text: 'object' } }];

      const metadata = { name: 'test', arguments: [] };
      const result = buildParsedPromptResult(input, metadata);
      expect(result.messages).toHaveLength(2);
      // First is normalized from string
      expect(result.messages[0].role).toBe('user');
      // Second is passed through
      expect(result.messages[1].role).toBe('user');
    });
  });
});
