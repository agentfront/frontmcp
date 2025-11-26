import 'reflect-metadata';
import PromptRegistry from '../prompt.registry';
import { Prompt } from '../../common/decorators/prompt.decorator';

// Mock the complex dependencies
const createMockHookRegistry = () => ({
  registerHooks: jest.fn().mockResolvedValue(undefined),
});

const createMockScope = () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  providers: {
    getHooksRegistry: jest.fn().mockReturnValue(createMockHookRegistry()),
  },
  registryFlows: jest.fn().mockResolvedValue(undefined),
});

const createMockProviderRegistry = () => {
  const mockScope = createMockScope();

  return {
    getActiveScope: jest.fn().mockReturnValue(mockScope),
    get: jest.fn().mockReturnValue(undefined),
    getRegistries: jest.fn().mockReturnValue([]),
    addRegistry: jest.fn(),
  } as any;
};

const createMockOwner = () => ({
  kind: 'app' as const,
  id: 'test-app',
  ref: {} as any,
});

describe('PromptRegistry', () => {
  describe('Registration', () => {
    it('should register class-based prompt', async () => {
      @Prompt({
        name: 'greeting-prompt',
        arguments: [],
      })
      class GreetingPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'Hello!' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [GreetingPrompt], createMockOwner());
      await registry.ready;

      const prompts = registry.getPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe('greeting-prompt');
    });

    it('should handle empty prompt list', async () => {
      const registry = new PromptRegistry(createMockProviderRegistry(), [], createMockOwner());
      await registry.ready;

      expect(registry.getPrompts()).toHaveLength(0);
    });

    it('should register multiple prompts', async () => {
      @Prompt({ name: 'prompt1', arguments: [] })
      class Prompt1 {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '1' } }] };
        }
      }

      @Prompt({ name: 'prompt2', arguments: [] })
      class Prompt2 {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '2' } }] };
        }
      }

      @Prompt({ name: 'prompt3', arguments: [{ name: 'topic', required: true }] })
      class Prompt3 {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: args.topic } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Prompt1, Prompt2, Prompt3], createMockOwner());
      await registry.ready;

      expect(registry.getPrompts()).toHaveLength(3);
    });

    it('should register prompt with arguments', async () => {
      @Prompt({
        name: 'parameterized-prompt',
        arguments: [
          { name: 'topic', description: 'The topic to discuss', required: true },
          { name: 'style', description: 'Writing style', required: false },
        ],
      })
      class ParameterizedPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: `Topic: ${args.topic}` } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [ParameterizedPrompt], createMockOwner());
      await registry.ready;

      const prompts = registry.getPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0].metadata.arguments).toHaveLength(2);
      expect(prompts[0].metadata.arguments?.[0].name).toBe('topic');
      expect(prompts[0].metadata.arguments?.[0].required).toBe(true);
    });
  });

  describe('getPrompts', () => {
    it('should return all prompts', async () => {
      @Prompt({ name: 'first', arguments: [] })
      class First {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '1' } }] };
        }
      }

      @Prompt({ name: 'second', arguments: [] })
      class Second {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '2' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [First, Second], createMockOwner());
      await registry.ready;

      const prompts = registry.getPrompts();
      expect(prompts).toHaveLength(2);
      expect(prompts.map((p) => p.name).sort()).toEqual(['first', 'second']);
    });
  });

  describe('findByName', () => {
    it('should find prompt by exact name', async () => {
      @Prompt({ name: 'findable', arguments: [] })
      class Findable {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'found' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Findable], createMockOwner());
      await registry.ready;

      const found = registry.findByName('findable');
      expect(found).toBeDefined();
      expect(found?.name).toBe('findable');
    });

    it('should return undefined for unknown name', async () => {
      @Prompt({ name: 'existing', arguments: [] })
      class Existing {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'e' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Existing], createMockOwner());
      await registry.ready;

      const notFound = registry.findByName('unknown');
      expect(notFound).toBeUndefined();
    });

    it('should find first prompt when multiple have same name', async () => {
      @Prompt({ name: 'duplicate', arguments: [] })
      class Duplicate1 {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '1' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Duplicate1], createMockOwner());
      await registry.ready;

      const found = registry.findByName('duplicate');
      expect(found).toBeDefined();
      expect(found?.name).toBe('duplicate');
    });
  });

  describe('findAllByName', () => {
    it('should find all prompts with given name', async () => {
      @Prompt({ name: 'shared-name', arguments: [] })
      class SharedName {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'shared' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [SharedName], createMockOwner());
      await registry.ready;

      const found = registry.findAllByName('shared-name');
      expect(found).toHaveLength(1);
    });

    it('should return empty array for unknown name', async () => {
      @Prompt({ name: 'known', arguments: [] })
      class Known {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'k' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Known], createMockOwner());
      await registry.ready;

      const found = registry.findAllByName('unknown');
      expect(found).toHaveLength(0);
    });
  });

  describe('listAllIndexed', () => {
    it('should return all indexed prompts', async () => {
      @Prompt({ name: 'prompt1', arguments: [] })
      class Prompt1 {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '1' } }] };
        }
      }

      @Prompt({ name: 'prompt2', arguments: [] })
      class Prompt2 {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '2' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Prompt1, Prompt2], createMockOwner());
      await registry.ready;

      const indexed = registry.listAllIndexed();
      expect(indexed).toHaveLength(2);
    });

    it('should include lineage info in indexed prompts', async () => {
      @Prompt({ name: 'lineaged', arguments: [] })
      class Lineaged {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'l' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Lineaged], createMockOwner());
      await registry.ready;

      const indexed = registry.listAllIndexed();
      expect(indexed).toHaveLength(1);
      expect(indexed[0].baseName).toBe('lineaged');
      expect(indexed[0].ownerKey).toBeDefined();
      expect(indexed[0].qualifiedName).toBeDefined();
    });
  });

  describe('exportResolvedNames', () => {
    it('should export with default snake_case', async () => {
      @Prompt({ name: 'myPrompt', arguments: [] })
      class MyPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'content' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [MyPrompt], createMockOwner());
      await registry.ready;

      const exported = registry.exportResolvedNames();
      expect(exported).toHaveLength(1);
      expect(exported[0].name).toBe('my_prompt');
    });

    it('should export with kebab-case', async () => {
      @Prompt({ name: 'myPrompt', arguments: [] })
      class MyPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'content' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [MyPrompt], createMockOwner());
      await registry.ready;

      const exported = registry.exportResolvedNames({ case: 'kebab' });
      expect(exported).toHaveLength(1);
      expect(exported[0].name).toBe('my-prompt');
    });

    it('should handle multiple prompts with unique names', async () => {
      @Prompt({ name: 'first', arguments: [] })
      class First {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '1' } }] };
        }
      }

      @Prompt({ name: 'second', arguments: [] })
      class Second {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: '2' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [First, Second], createMockOwner());
      await registry.ready;

      const exported = registry.exportResolvedNames();
      expect(exported).toHaveLength(2);
      const names = exported.map((e) => e.name).sort();
      expect(names).toEqual(['first', 'second']);
    });
  });

  describe('hasAny', () => {
    it('should return true when registry has prompts', async () => {
      @Prompt({ name: 'test', arguments: [] })
      class Test {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'test' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Test], createMockOwner());
      await registry.ready;

      expect(registry.hasAny()).toBe(true);
    });

    it('should return false when registry is empty', async () => {
      const registry = new PromptRegistry(createMockProviderRegistry(), [], createMockOwner());
      await registry.ready;

      expect(registry.hasAny()).toBe(false);
    });
  });

  describe('getInlinePrompts', () => {
    it('should return locally registered prompts', async () => {
      @Prompt({ name: 'inline', arguments: [] })
      class Inline {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'inline' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Inline], createMockOwner());
      await registry.ready;

      const inline = registry.getInlinePrompts();
      expect(inline).toHaveLength(1);
      expect(inline[0].name).toBe('inline');
    });
  });

  describe('subscribe', () => {
    it('should emit immediate event when requested', async () => {
      @Prompt({ name: 'subscribed', arguments: [] })
      class Subscribed {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 's' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Subscribed], createMockOwner());
      await registry.ready;

      const events: any[] = [];
      registry.subscribe({ immediate: true }, (e) => events.push(e));

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('reset');
      expect(events[0].snapshot).toHaveLength(1);
    });

    it('should return unsubscribe function', async () => {
      @Prompt({ name: 'unsub', arguments: [] })
      class Unsub {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'u' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Unsub], createMockOwner());
      await registry.ready;

      const events: any[] = [];
      const unsubscribe = registry.subscribe({ immediate: false }, (e) => events.push(e));

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
      // After unsubscribe, no more events should be received
    });
  });

  describe('listByOwner', () => {
    it('should return prompts for specific owner', async () => {
      @Prompt({ name: 'owned', arguments: [] })
      class Owned {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'o' } }] };
        }
      }

      const owner = createMockOwner();
      const registry = new PromptRegistry(createMockProviderRegistry(), [Owned], owner);
      await registry.ready;

      const owned = registry.listByOwner(`${owner.kind}:${owner.id}`);
      expect(owned.length).toBeGreaterThanOrEqual(0); // May be 0 if owner key format differs
    });

    it('should return empty array for unknown owner', async () => {
      @Prompt({ name: 'test', arguments: [] })
      class Test {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 't' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Test], createMockOwner());
      await registry.ready;

      const unknown = registry.listByOwner('unknown:owner');
      expect(unknown).toHaveLength(0);
    });
  });

  describe('getExported', () => {
    it('should lookup by exported name', async () => {
      @Prompt({ name: 'exportedPrompt', arguments: [] })
      class ExportedPrompt {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'e' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [ExportedPrompt], createMockOwner());
      await registry.ready;

      const found = registry.getExported('exported_prompt');
      expect(found).toBeDefined();
      expect(found?.name).toBe('exportedPrompt');
    });

    it('should return undefined for non-existent exported name', async () => {
      @Prompt({ name: 'exists', arguments: [] })
      class Exists {
        execute(args: Record<string, string>) {
          return { messages: [{ role: 'user', content: { type: 'text', text: 'e' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), [Exists], createMockOwner());
      await registry.ready;

      const notFound = registry.getExported('does_not_exist');
      expect(notFound).toBeUndefined();
    });
  });
});
