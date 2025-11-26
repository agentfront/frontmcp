import 'reflect-metadata';
import { PromptInstance } from '../prompt.instance';
import { PromptKind, Prompt, prompt, PromptContext } from '../../common';
import { normalizePrompt } from '../prompt.utils';
import { createMockProviderRegistry, createMockOwner } from '../../__test-utils__/mocks';

describe('PromptInstance', () => {
  describe('constructor', () => {
    it('should set name from metadata', async () => {
      @Prompt({
        name: 'test-prompt',
        arguments: [],
      })
      class TestPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'content' } }] };
        }
      }

      const record = normalizePrompt(TestPrompt);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.name).toBe('test-prompt');
    });

    it('should set fullName with owner prefix', async () => {
      @Prompt({
        name: 'named',
        arguments: [],
      })
      class NamedPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'content' } }] };
        }
      }

      const record = normalizePrompt(NamedPrompt);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.fullName).toBe('test-app:named');
    });

    it('should set owner reference', async () => {
      @Prompt({
        name: 'owned',
        arguments: [],
      })
      class OwnedPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'content' } }] };
        }
      }

      const owner = createMockOwner();
      const record = normalizePrompt(OwnedPrompt);
      const instance = new PromptInstance(record, createMockProviderRegistry(), owner);
      await instance.ready;

      expect(instance.owner).toBe(owner);
      expect(instance.owner.kind).toBe('app');
      expect(instance.owner.id).toBe('test-app');
    });
  });

  describe('getMetadata', () => {
    it('should return PromptMetadata', async () => {
      @Prompt({
        name: 'meta-prompt',
        title: 'Prompt Title',
        description: 'Prompt description',
        arguments: [{ name: 'topic', required: true }],
      })
      class MetaPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'content' } }] };
        }
      }

      const record = normalizePrompt(MetaPrompt);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const metadata = instance.getMetadata();
      expect(metadata.name).toBe('meta-prompt');
      expect(metadata.title).toBe('Prompt Title');
      expect(metadata.description).toBe('Prompt description');
      expect(metadata.arguments).toHaveLength(1);
      expect(metadata.arguments?.[0].name).toBe('topic');
    });

    it('should include optional fields when provided', async () => {
      @Prompt({
        name: 'full-meta',
        title: 'Full Title',
        description: 'Full description',
        arguments: [
          { name: 'arg1', description: 'First argument', required: true },
          { name: 'arg2', description: 'Second argument', required: false },
        ],
      })
      class FullMeta {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'content' } }] };
        }
      }

      const record = normalizePrompt(FullMeta);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const metadata = instance.getMetadata();
      expect(metadata.arguments).toHaveLength(2);
      expect(metadata.arguments?.[0].description).toBe('First argument');
      expect(metadata.arguments?.[1].required).toBe(false);
    });
  });

  describe('parseArguments', () => {
    it('should pass through valid arguments', async () => {
      @Prompt({
        name: 'args-prompt',
        arguments: [{ name: 'topic', required: false }],
      })
      class ArgsPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: args['topic'] } }] };
        }
      }

      const record = normalizePrompt(ArgsPrompt);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseArguments({ topic: 'test topic' });
      expect(result['topic']).toBe('test topic');
    });

    it('should throw for missing required argument', async () => {
      @Prompt({
        name: 'required-args',
        arguments: [{ name: 'required_field', required: true }],
      })
      class RequiredArgs {
        execute(args: Record<string, string>) {
          return {
            messages: [{ role: 'user' as const, content: { type: 'text' as const, text: args['required_field'] } }],
          };
        }
      }

      const record = normalizePrompt(RequiredArgs);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(() => instance.parseArguments({})).toThrow('Missing required argument: required_field');
    });

    it('should not throw for missing optional argument', async () => {
      @Prompt({
        name: 'optional-args',
        arguments: [{ name: 'optional_field', required: false }],
      })
      class OptionalArgs {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'ok' } }] };
        }
      }

      const record = normalizePrompt(OptionalArgs);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(() => instance.parseArguments({})).not.toThrow();
    });

    it('should handle undefined args', async () => {
      @Prompt({
        name: 'no-args',
        arguments: [],
      })
      class NoArgs {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'no args' } }] };
        }
      }

      const record = normalizePrompt(NoArgs);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseArguments(undefined);
      expect(result).toEqual({});
    });

    it('should include extra arguments not in definition', async () => {
      @Prompt({
        name: 'extra-args',
        arguments: [{ name: 'defined', required: false }],
      })
      class ExtraArgs {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'extra' } }] };
        }
      }

      const record = normalizePrompt(ExtraArgs);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseArguments({ defined: 'yes', extra: 'also yes' });
      expect(result['defined']).toBe('yes');
      expect(result['extra']).toBe('also yes');
    });
  });

  describe('parseOutput', () => {
    it('should convert string to user message', async () => {
      @Prompt({
        name: 'string-output',
        arguments: [],
      })
      class StringOutput {
        execute(args: Record<string, string>) {
          return 'plain text response';
        }
      }

      const record = normalizePrompt(StringOutput);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseOutput('plain text response' as any);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect((result.messages[0].content as any).text).toBe('plain text response');
    });

    it('should pass through GetPromptResult format', async () => {
      @Prompt({
        name: 'passthrough',
        arguments: [],
      })
      class Passthrough {
        execute(args: Record<string, string>) {
          return {
            messages: [{ role: 'assistant', content: { type: 'text', text: 'existing' } }],
          };
        }
      }

      const record = normalizePrompt(Passthrough);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const input = {
        messages: [{ role: 'assistant', content: { type: 'text', text: 'existing' } }],
      };
      const result = instance.parseOutput(input as any);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('assistant');
    });

    it('should handle array of messages', async () => {
      @Prompt({
        name: 'array-output',
        arguments: [],
      })
      class ArrayOutput {
        execute(args: Record<string, string>) {
          return [
            { role: 'user', content: { type: 'text', text: 'first' } },
            { role: 'assistant', content: { type: 'text', text: 'second' } },
          ];
        }
      }

      const record = normalizePrompt(ArrayOutput);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const input = [
        { role: 'user', content: { type: 'text', text: 'first' } },
        { role: 'assistant', content: { type: 'text', text: 'second' } },
      ];
      const result = instance.parseOutput(input as any);
      expect(result.messages).toHaveLength(2);
    });

    it('should convert object to JSON user message', async () => {
      @Prompt({
        name: 'object-output',
        arguments: [],
      })
      class ObjectOutput {
        execute(args: Record<string, string>) {
          return { key: 'value', num: 42 };
        }
      }

      const record = normalizePrompt(ObjectOutput);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseOutput({ key: 'value', num: 42 } as any);
      expect(result.messages).toHaveLength(1);
      expect((result.messages[0].content as any).text).toBe(JSON.stringify({ key: 'value', num: 42 }));
    });

    it('should use description from metadata', async () => {
      @Prompt({
        name: 'described',
        description: 'A test prompt',
        arguments: [],
      })
      class Described {
        execute(args: Record<string, string>) {
          return 'response';
        }
      }

      const record = normalizePrompt(Described);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseOutput('response' as any);
      expect(result.description).toBe('A test prompt');
    });
  });

  describe('safeParseOutput', () => {
    it('should return success with parsed content', async () => {
      @Prompt({
        name: 'safe-success',
        arguments: [],
      })
      class SafeSuccess {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'content' } }] };
        }
      }

      const record = normalizePrompt(SafeSuccess);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.safeParseOutput('content');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.messages).toHaveLength(1);
      }
    });

    it('should handle null output gracefully', async () => {
      @Prompt({
        name: 'safe-null',
        arguments: [],
      })
      class SafeNull {
        execute(args: Record<string, string>) {
          return null;
        }
      }

      const record = normalizePrompt(SafeNull);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.safeParseOutput(null);
      expect(result.success).toBe(true);
    });

    it('should handle undefined output', async () => {
      @Prompt({
        name: 'safe-undefined',
        arguments: [],
      })
      class SafeUndefined {
        execute(args: Record<string, string>) {
          return undefined;
        }
      }

      const record = normalizePrompt(SafeUndefined);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.safeParseOutput(undefined);
      expect(result.success).toBe(true);
    });
  });

  describe('record', () => {
    it('should preserve the original record', async () => {
      @Prompt({
        name: 'record-test',
        arguments: [],
      })
      class RecordTest {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'r' } }] };
        }
      }

      const record = normalizePrompt(RecordTest);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.record).toBe(record);
      expect(instance.record.kind).toBe(PromptKind.CLASS_TOKEN);
    });
  });

  describe('metadata', () => {
    it('should expose metadata from record', async () => {
      @Prompt({
        name: 'meta-access',
        title: 'Access Title',
        arguments: [],
      })
      class MetaAccess {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'm' } }] };
        }
      }

      const record = normalizePrompt(MetaAccess);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.metadata.name).toBe('meta-access');
      expect(instance.metadata.title).toBe('Access Title');
    });
  });

  describe('create', () => {
    it('should create context for CLASS_TOKEN prompt', async () => {
      @Prompt({
        name: 'class-prompt',
        arguments: [{ name: 'topic', required: false }],
      })
      class ClassPrompt extends PromptContext {
        async execute(args: Record<string, string>) {
          return {
            messages: [{ role: 'user' as const, content: { type: 'text' as const, text: args['topic'] || 'default' } }],
          };
        }
      }

      const record = normalizePrompt(ClassPrompt);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const mockCtx = {
        authInfo: { token: 'test-token' },
      } as any;

      const context = instance.create({ topic: 'test' }, mockCtx);
      expect(context).toBeDefined();
      expect(context.args).toEqual({ topic: 'test' });
    });

    it('should create context for FUNCTION prompt', async () => {
      const FunctionPrompt = prompt({
        name: 'function-prompt',
        arguments: [{ name: 'name', required: true }],
      })((args) => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Hello ${args?.['name']}` } }],
      }));

      const record = normalizePrompt(FunctionPrompt);
      expect(record.kind).toBe(PromptKind.FUNCTION);

      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const mockCtx = {
        authInfo: { token: 'test-token' },
      } as any;

      const context = instance.create({ name: 'World' }, mockCtx);
      expect(context).toBeDefined();
      expect(context.args).toEqual({ name: 'World' });
    });
  });

  describe('safeParseOutput failure', () => {
    it('should return error for invalid output that throws', async () => {
      @Prompt({
        name: 'failing-output',
        arguments: [],
      })
      class FailingOutput {
        execute() {
          return { messages: [] };
        }
      }

      const record = normalizePrompt(FailingOutput);
      const instance = new PromptInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      // Mock parseOutput to throw
      const originalParseOutput = instance.parseOutput.bind(instance);
      instance.parseOutput = jest.fn().mockImplementation(() => {
        throw new Error('Parsing failed');
      });

      const result = instance.safeParseOutput({ invalid: 'data' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('Parsing failed');
      }

      // Restore original
      instance.parseOutput = originalParseOutput;
    });
  });
});
