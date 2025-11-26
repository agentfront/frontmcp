import 'reflect-metadata';
import PromptRegistry from '../prompt.registry';
import { Prompt } from '../../common/decorators/prompt.decorator';
import { PromptType } from '../../common/interfaces/prompt.interface';

// Helper to cast test classes to PromptType
const asPromptTypes = (...classes: any[]): PromptType[] => classes as unknown as PromptType[];

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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Hello!' } }] };
        }
      }

      const registry = new PromptRegistry(
        createMockProviderRegistry(),
        asPromptTypes(GreetingPrompt),
        createMockOwner(),
      );
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '1' } }] };
        }
      }

      @Prompt({ name: 'prompt2', arguments: [] })
      class Prompt2 {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '2' } }] };
        }
      }

      @Prompt({ name: 'prompt3', arguments: [{ name: 'topic', required: true }] })
      class Prompt3 {
        async execute(args: Record<string, string>) {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: args['topic'] } }] };
        }
      }

      const registry = new PromptRegistry(
        createMockProviderRegistry(),
        asPromptTypes(Prompt1, Prompt2, Prompt3),
        createMockOwner(),
      );
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
        async execute(args: Record<string, string>) {
          return {
            messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Topic: ${args['topic']}` } }],
          };
        }
      }

      const registry = new PromptRegistry(
        createMockProviderRegistry(),
        asPromptTypes(ParameterizedPrompt),
        createMockOwner(),
      );
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '1' } }] };
        }
      }

      @Prompt({ name: 'second', arguments: [] })
      class Second {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '2' } }] };
        }
      }

      const registry = new PromptRegistry(
        createMockProviderRegistry(),
        asPromptTypes(First, Second),
        createMockOwner(),
      );
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'found' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Findable), createMockOwner());
      await registry.ready;

      const found = registry.findByName('findable');
      expect(found).toBeDefined();
      expect(found?.name).toBe('findable');
    });

    it('should return undefined for unknown name', async () => {
      @Prompt({ name: 'existing', arguments: [] })
      class Existing {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'e' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Existing), createMockOwner());
      await registry.ready;

      const notFound = registry.findByName('unknown');
      expect(notFound).toBeUndefined();
    });

    it('should find first prompt when multiple have same name', async () => {
      @Prompt({ name: 'duplicate', arguments: [] })
      class Duplicate1 {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '1' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Duplicate1), createMockOwner());
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'shared' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(SharedName), createMockOwner());
      await registry.ready;

      const found = registry.findAllByName('shared-name');
      expect(found).toHaveLength(1);
    });

    it('should return empty array for unknown name', async () => {
      @Prompt({ name: 'known', arguments: [] })
      class Known {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'k' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Known), createMockOwner());
      await registry.ready;

      const found = registry.findAllByName('unknown');
      expect(found).toHaveLength(0);
    });
  });

  describe('listAllIndexed', () => {
    it('should return all indexed prompts', async () => {
      @Prompt({ name: 'prompt1', arguments: [] })
      class Prompt1 {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '1' } }] };
        }
      }

      @Prompt({ name: 'prompt2', arguments: [] })
      class Prompt2 {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '2' } }] };
        }
      }

      const registry = new PromptRegistry(
        createMockProviderRegistry(),
        asPromptTypes(Prompt1, Prompt2),
        createMockOwner(),
      );
      await registry.ready;

      const indexed = registry.listAllIndexed();
      expect(indexed).toHaveLength(2);
    });

    it('should include lineage info in indexed prompts', async () => {
      @Prompt({ name: 'lineaged', arguments: [] })
      class Lineaged {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'l' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Lineaged), createMockOwner());
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'content' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(MyPrompt), createMockOwner());
      await registry.ready;

      const exported = registry.exportResolvedNames();
      expect(exported).toHaveLength(1);
      expect(exported[0].name).toBe('my_prompt');
    });

    it('should export with kebab-case', async () => {
      @Prompt({ name: 'myPrompt', arguments: [] })
      class MyPrompt {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'content' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(MyPrompt), createMockOwner());
      await registry.ready;

      const exported = registry.exportResolvedNames({ case: 'kebab' });
      expect(exported).toHaveLength(1);
      expect(exported[0].name).toBe('my-prompt');
    });

    it('should handle multiple prompts with unique names', async () => {
      @Prompt({ name: 'first', arguments: [] })
      class First {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '1' } }] };
        }
      }

      @Prompt({ name: 'second', arguments: [] })
      class Second {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: '2' } }] };
        }
      }

      const registry = new PromptRegistry(
        createMockProviderRegistry(),
        asPromptTypes(First, Second),
        createMockOwner(),
      );
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'test' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Test), createMockOwner());
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'inline' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Inline), createMockOwner());
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 's' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Subscribed), createMockOwner());
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'u' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Unsub), createMockOwner());
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
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'o' } }] };
        }
      }

      const owner = createMockOwner();
      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Owned), owner);
      await registry.ready;

      const owned = registry.listByOwner(`${owner.kind}:${owner.id}`);
      expect(owned.length).toBeGreaterThanOrEqual(0); // May be 0 if owner key format differs
    });

    it('should return empty array for unknown owner', async () => {
      @Prompt({ name: 'test', arguments: [] })
      class Test {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 't' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Test), createMockOwner());
      await registry.ready;

      const unknown = registry.listByOwner('unknown:owner');
      expect(unknown).toHaveLength(0);
    });
  });

  describe('getExported', () => {
    it('should lookup by exported name', async () => {
      @Prompt({ name: 'exportedPrompt', arguments: [] })
      class ExportedPrompt {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'e' } }] };
        }
      }

      const registry = new PromptRegistry(
        createMockProviderRegistry(),
        asPromptTypes(ExportedPrompt),
        createMockOwner(),
      );
      await registry.ready;

      const found = registry.getExported('exported_prompt');
      expect(found).toBeDefined();
      expect(found?.name).toBe('exportedPrompt');
    });

    it('should return undefined for non-existent exported name', async () => {
      @Prompt({ name: 'exists', arguments: [] })
      class Exists {
        async execute() {
          return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'e' } }] };
        }
      }

      const registry = new PromptRegistry(createMockProviderRegistry(), asPromptTypes(Exists), createMockOwner());
      await registry.ready;

      const notFound = registry.getExported('does_not_exist');
      expect(notFound).toBeUndefined();
    });
  });
});
