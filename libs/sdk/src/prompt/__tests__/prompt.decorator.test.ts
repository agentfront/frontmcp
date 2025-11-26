import 'reflect-metadata';
import { Prompt, FrontMcpPrompt, prompt, frontMcpPrompt } from '../../common/decorators/prompt.decorator';
import { FrontMcpPromptTokens } from '../../common/tokens';

describe('prompt.decorator', () => {
  describe('Prompt (class decorator)', () => {
    it('should apply metadata to class', () => {
      @Prompt({
        name: 'test-prompt',
        arguments: [],
      })
      class TestPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const isPrompt = Reflect.getMetadata(FrontMcpPromptTokens.type, TestPrompt);
      expect(isPrompt).toBe(true);
    });

    it('should store name metadata', () => {
      @Prompt({
        name: 'named-prompt',
        arguments: [],
      })
      class NamedPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const name = Reflect.getMetadata(FrontMcpPromptTokens.name, NamedPrompt);
      expect(name).toBe('named-prompt');
    });

    it('should store title metadata', () => {
      @Prompt({
        name: 'titled-prompt',
        title: 'Prompt Title',
        arguments: [],
      })
      class TitledPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const title = Reflect.getMetadata(FrontMcpPromptTokens.title, TitledPrompt);
      expect(title).toBe('Prompt Title');
    });

    it('should store description metadata', () => {
      @Prompt({
        name: 'described-prompt',
        description: 'Prompt Description',
        arguments: [],
      })
      class DescribedPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const description = Reflect.getMetadata(FrontMcpPromptTokens.description, DescribedPrompt);
      expect(description).toBe('Prompt Description');
    });

    it('should store arguments metadata', () => {
      @Prompt({
        name: 'args-prompt',
        arguments: [
          { name: 'topic', description: 'The topic', required: true },
          { name: 'style', description: 'The style', required: false },
        ],
      })
      class ArgsPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const args = Reflect.getMetadata(FrontMcpPromptTokens.arguments, ArgsPrompt);
      expect(args).toHaveLength(2);
      expect(args[0].name).toBe('topic');
      expect(args[0].required).toBe(true);
      expect(args[1].name).toBe('style');
      expect(args[1].required).toBe(false);
    });

    it('should handle empty arguments array', () => {
      @Prompt({
        name: 'no-args-prompt',
        arguments: [],
      })
      class NoArgsPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const args = Reflect.getMetadata(FrontMcpPromptTokens.arguments, NoArgsPrompt);
      expect(args).toEqual([]);
    });

    it('should validate metadata with zod schema', () => {
      // Empty name should fail
      expect(() => {
        @Prompt({
          name: '',
          arguments: [],
        })
        class InvalidPrompt {
          execute(args: Record<string, string>) {
            return { messages: [] };
          }
        }
      }).toThrow();
    });
  });

  describe('FrontMcpPrompt (alias)', () => {
    it('should be an alias for Prompt', () => {
      expect(FrontMcpPrompt).toBe(Prompt);
    });

    it('should work identically to Prompt', () => {
      @FrontMcpPrompt({
        name: 'alias-test',
        arguments: [],
      })
      class AliasTest {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const isPrompt = Reflect.getMetadata(FrontMcpPromptTokens.type, AliasTest);
      const name = Reflect.getMetadata(FrontMcpPromptTokens.name, AliasTest);
      expect(isPrompt).toBe(true);
      expect(name).toBe('alias-test');
    });
  });

  describe('prompt (function decorator)', () => {
    it('should create function-style prompt', () => {
      const myPrompt = prompt({
        name: 'function-prompt',
        arguments: [],
      })(() => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'hello' } }],
      }));

      expect(typeof myPrompt).toBe('function');
      expect(myPrompt[FrontMcpPromptTokens.type]).toBe('function-prompt');
    });

    it('should store metadata on function', () => {
      const myPrompt = prompt({
        name: 'meta-function',
        title: 'Function Title',
        description: 'Function Description',
        arguments: [{ name: 'arg1', required: true }],
      })(() => ({
        messages: [],
      }));

      const metadata = myPrompt[FrontMcpPromptTokens.metadata];
      expect(metadata.name).toBe('meta-function');
      expect(metadata.title).toBe('Function Title');
      expect(metadata.description).toBe('Function Description');
      expect(metadata.arguments).toHaveLength(1);
    });

    it('should return handler when called', () => {
      const handler = () => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'test' } }],
      });

      const myPrompt = prompt({
        name: 'callable',
        arguments: [],
      })(handler);

      const returnedHandler = myPrompt();
      expect(returnedHandler).toBe(handler);
    });

    it('should preserve async handlers', () => {
      const asyncHandler = async () => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'async' } }],
      });

      const myPrompt = prompt({
        name: 'async-prompt',
        arguments: [],
      })(asyncHandler);

      const returnedHandler = myPrompt();
      expect(returnedHandler).toBe(asyncHandler);
    });

    it('should handle arguments in metadata', () => {
      const myPrompt = prompt({
        name: 'args-function',
        arguments: [
          { name: 'topic', description: 'Topic to discuss', required: true },
          { name: 'format', description: 'Output format', required: false },
        ],
      })((args) => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: args?.['topic'] || 'default' } }],
      }));

      const metadata = myPrompt[FrontMcpPromptTokens.metadata];
      expect(metadata.arguments).toHaveLength(2);
      expect(metadata.arguments[0].name).toBe('topic');
      expect(metadata.arguments[1].required).toBe(false);
    });
  });

  describe('frontMcpPrompt (alias)', () => {
    it('should be an alias for prompt', () => {
      expect(frontMcpPrompt).toBe(prompt);
    });

    it('should work identically to prompt', () => {
      const myPrompt = frontMcpPrompt({
        name: 'alias-function',
        arguments: [],
      })((args) => ({
        messages: [],
      }));

      expect(myPrompt[FrontMcpPromptTokens.type]).toBe('function-prompt');
      expect(myPrompt[FrontMcpPromptTokens.metadata].name).toBe('alias-function');
    });
  });

  describe('metadata validation', () => {
    it('should require name field', () => {
      expect(() => {
        @Prompt({
          name: '',
          arguments: [],
        } as any)
        class NoName {
          execute() {
            return { messages: [] };
          }
        }
      }).toThrow();
    });

    it('should allow undefined optional fields', () => {
      @Prompt({
        name: 'minimal-metadata',
        arguments: [],
      })
      class MinimalMetadata {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const title = Reflect.getMetadata(FrontMcpPromptTokens.title, MinimalMetadata);
      const description = Reflect.getMetadata(FrontMcpPromptTokens.description, MinimalMetadata);
      expect(title).toBeUndefined();
      expect(description).toBeUndefined();
    });

    it('should pass through additional metadata fields', () => {
      @Prompt({
        name: 'extended',
        arguments: [],
        // Any passthrough fields would go here
      } as any)
      class ExtendedPrompt {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const name = Reflect.getMetadata(FrontMcpPromptTokens.name, ExtendedPrompt);
      expect(name).toBe('extended');
    });
  });

  describe('argument definitions', () => {
    it('should handle argument with all fields', () => {
      @Prompt({
        name: 'full-args',
        arguments: [
          {
            name: 'complete',
            description: 'Complete argument',
            required: true,
          },
        ],
      })
      class FullArgs {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const args = Reflect.getMetadata(FrontMcpPromptTokens.arguments, FullArgs);
      expect(args[0]).toEqual({
        name: 'complete',
        description: 'Complete argument',
        required: true,
      });
    });

    it('should handle argument with minimal fields', () => {
      @Prompt({
        name: 'minimal-args',
        arguments: [{ name: 'minimal' }],
      })
      class MinimalArgs {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const args = Reflect.getMetadata(FrontMcpPromptTokens.arguments, MinimalArgs);
      expect(args[0].name).toBe('minimal');
      expect(args[0].required).toBeUndefined();
      expect(args[0].description).toBeUndefined();
    });

    it('should handle multiple arguments', () => {
      @Prompt({
        name: 'multi-args',
        arguments: [{ name: 'first', required: true }, { name: 'second', required: false }, { name: 'third' }],
      })
      class MultiArgs {
        execute(args: Record<string, string>) {
          return { messages: [] };
        }
      }

      const args = Reflect.getMetadata(FrontMcpPromptTokens.arguments, MultiArgs);
      expect(args).toHaveLength(3);
      expect(args[0].name).toBe('first');
      expect(args[1].name).toBe('second');
      expect(args[2].name).toBe('third');
    });
  });
});
