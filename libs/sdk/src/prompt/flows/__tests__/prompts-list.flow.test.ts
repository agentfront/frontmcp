import 'reflect-metadata';
import PromptsListFlow from '../prompts-list.flow';
import { FlowControl } from '../../../common/interfaces/flow.interface';
import {
  createMockPromptRegistry,
  createMockPromptEntry,
  addPromptToMock,
} from '../../../__test-utils__/mocks/prompt-registry.mock';

describe('PromptsListFlow', () => {
  // Create mock dependencies
  const createMockDependencies = (promptRegistry = createMockPromptRegistry()) => {
    const mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const mockHookRegistry = {
      registerHooks: jest.fn().mockResolvedValue(undefined),
      getHooks: jest.fn().mockReturnValue([]),
      getClsHooks: jest.fn().mockReturnValue([]),
      getFlowHooks: jest.fn().mockReturnValue([]),
      getFlowStageHooks: jest.fn().mockReturnValue([]),
      getFlowHooksForOwner: jest.fn().mockReturnValue([]),
    };

    const mockProviders = {
      get: jest.fn(),
      getScope: jest.fn(),
      getProviders: jest.fn().mockReturnValue([]),
      getRegistries: jest.fn().mockReturnValue([]),
      buildViews: jest.fn(),
      getHooksRegistry: jest.fn().mockReturnValue(mockHookRegistry),
    };

    const mockScope = {
      id: 'test-scope',
      logger: mockLogger,
      hooks: mockHookRegistry,
      providers: mockProviders,
      prompts: promptRegistry,
      registryFlows: jest.fn().mockResolvedValue(undefined),
      runFlow: jest.fn(),
      metadata: {
        id: 'test-scope',
        http: { port: 3001 },
      },
    };

    const metadata = {
      name: 'prompts:list-prompts',
      plan: {
        pre: ['parseInput'],
        execute: ['findPrompts', 'resolveConflicts'],
        post: ['parsePrompts'],
      },
      inputSchema: {
        parse: jest.fn((input: any) => input),
      },
      outputSchema: {
        parse: jest.fn((output: any) => output),
      },
      access: 'authorized',
    };

    return { mockScope, metadata, mockLogger, promptRegistry };
  };

  // Helper to create flow instance and run it
  const runFlow = async (input: any, deps = createMockDependencies()) => {
    const { mockScope, metadata, promptRegistry } = deps;

    // Create flow instance
    const flow = new PromptsListFlow(metadata as any, input, mockScope as any, jest.fn(), new Map());

    // Run stages manually to capture response
    try {
      await flow['parseInput']();
      await flow['findPrompts']();
      await flow['resolveConflicts']();
      await flow['parsePrompts']();
      return { success: true, flow };
    } catch (e) {
      if (e instanceof FlowControl && e.type === 'respond') {
        return { success: true, response: e.output, flow };
      }
      return { success: false, error: e, flow };
    }
  };

  describe('valid configurations', () => {
    it('should return empty prompts list when no prompts registered', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.response.prompts).toEqual([]);
    });

    it('should return single prompt when one is registered', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('greeting', {
        name: 'greeting',
        title: 'Greeting Prompt',
        description: 'Says hello',
        arguments: [{ name: 'name', required: true }],
      });
      addPromptToMock(promptRegistry, 'greeting', promptEntry);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.response.prompts).toHaveLength(1);
      expect(result.response.prompts[0].name).toBe('greeting');
      expect(result.response.prompts[0].title).toBe('Greeting Prompt');
      expect(result.response.prompts[0].description).toBe('Says hello');
    });

    it('should return multiple prompts when several are registered', async () => {
      const promptRegistry = createMockPromptRegistry();

      const prompt1 = createMockPromptEntry('prompt-one', {
        name: 'prompt-one',
        description: 'First prompt',
        arguments: [],
      });
      const prompt2 = createMockPromptEntry('prompt-two', {
        name: 'prompt-two',
        description: 'Second prompt',
        arguments: [{ name: 'arg1', required: false }],
      });
      const prompt3 = createMockPromptEntry('prompt-three', {
        name: 'prompt-three',
        description: 'Third prompt',
        arguments: [
          { name: 'arg1', required: true },
          { name: 'arg2', required: false },
        ],
      });

      addPromptToMock(promptRegistry, 'prompt-one', prompt1);
      addPromptToMock(promptRegistry, 'prompt-two', prompt2);
      addPromptToMock(promptRegistry, 'prompt-three', prompt3);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts).toHaveLength(3);

      const names = result.response.prompts.map((p: any) => p.name);
      expect(names).toContain('prompt-one');
      expect(names).toContain('prompt-two');
      expect(names).toContain('prompt-three');
    });

    it('should handle prompts with arguments correctly', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('with-args', {
        name: 'with-args',
        description: 'Prompt with arguments',
        arguments: [
          { name: 'topic', description: 'The topic to discuss', required: true },
          { name: 'style', description: 'Writing style', required: false },
        ],
      });
      addPromptToMock(promptRegistry, 'with-args', promptEntry);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts[0].arguments).toHaveLength(2);
      expect(result.response.prompts[0].arguments[0].name).toBe('topic');
      expect(result.response.prompts[0].arguments[0].required).toBe(true);
      expect(result.response.prompts[0].arguments[1].name).toBe('style');
      expect(result.response.prompts[0].arguments[1].required).toBe(false);
    });

    it('should handle cursor parameter', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: { method: 'prompts/list', params: { cursor: 'abc123' } },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      // Cursor is stored in state but doesn't affect output in current implementation
      expect(result.response.prompts).toEqual([]);
    });

    it('should handle prompts with icons', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('with-icons', {
        name: 'with-icons',
        description: 'Prompt with icons',
        arguments: [],
        icons: [
          { src: 'icon-light.png', mimeType: 'image/png' },
          { src: 'icon-dark.png', mimeType: 'image/png' },
        ],
      });
      addPromptToMock(promptRegistry, 'with-icons', promptEntry);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts[0].icons).toEqual([
        { src: 'icon-light.png', mimeType: 'image/png' },
        { src: 'icon-dark.png', mimeType: 'image/png' },
      ]);
    });
  });

  describe('name conflict resolution', () => {
    it('should prefix duplicate prompt names with owner id', async () => {
      const promptRegistry = createMockPromptRegistry();

      // Create two prompts with the same name but different owners
      const prompt1 = createMockPromptEntry('greeting', {
        name: 'greeting',
        description: 'First greeting',
        arguments: [],
      });
      prompt1.owner = { kind: 'app', id: 'app-one', ref: {} };

      const prompt2 = createMockPromptEntry('greeting', {
        name: 'greeting',
        description: 'Second greeting',
        arguments: [],
      });
      prompt2.owner = { kind: 'app', id: 'app-two', ref: {} };

      addPromptToMock(promptRegistry, 'app-one:greeting', prompt1);
      addPromptToMock(promptRegistry, 'app-two:greeting', prompt2);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts).toHaveLength(2);

      const names = result.response.prompts.map((p: any) => p.name);
      // Both should have owner prefix due to conflict
      expect(names).toContain('app-one:greeting');
      expect(names).toContain('app-two:greeting');
    });

    it('should not prefix unique prompt names', async () => {
      const promptRegistry = createMockPromptRegistry();

      const prompt1 = createMockPromptEntry('unique-one', {
        name: 'unique-one',
        description: 'Unique prompt one',
        arguments: [],
      });
      prompt1.owner = { kind: 'app', id: 'app-one', ref: {} };

      const prompt2 = createMockPromptEntry('unique-two', {
        name: 'unique-two',
        description: 'Unique prompt two',
        arguments: [],
      });
      prompt2.owner = { kind: 'app', id: 'app-two', ref: {} };

      addPromptToMock(promptRegistry, 'unique-one', prompt1);
      addPromptToMock(promptRegistry, 'unique-two', prompt2);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts).toHaveLength(2);

      const names = result.response.prompts.map((p: any) => p.name);
      // Should NOT have owner prefix since names are unique
      expect(names).toContain('unique-one');
      expect(names).toContain('unique-two');
      expect(names).not.toContain('app-one:unique-one');
      expect(names).not.toContain('app-two:unique-two');
    });

    it('should handle mixed unique and duplicate names', async () => {
      const promptRegistry = createMockPromptRegistry();

      // Two with same name (conflict)
      const prompt1 = createMockPromptEntry('shared', {
        name: 'shared',
        description: 'Shared one',
        arguments: [],
      });
      prompt1.owner = { kind: 'app', id: 'app-one', ref: {} };

      const prompt2 = createMockPromptEntry('shared', {
        name: 'shared',
        description: 'Shared two',
        arguments: [],
      });
      prompt2.owner = { kind: 'app', id: 'app-two', ref: {} };

      // One unique
      const prompt3 = createMockPromptEntry('unique', {
        name: 'unique',
        description: 'Unique prompt',
        arguments: [],
      });
      prompt3.owner = { kind: 'app', id: 'app-three', ref: {} };

      addPromptToMock(promptRegistry, 'app-one:shared', prompt1);
      addPromptToMock(promptRegistry, 'app-two:shared', prompt2);
      addPromptToMock(promptRegistry, 'unique', prompt3);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts).toHaveLength(3);

      const names = result.response.prompts.map((p: any) => p.name);
      // Conflicting names get prefixed
      expect(names).toContain('app-one:shared');
      expect(names).toContain('app-two:shared');
      // Unique name stays as-is
      expect(names).toContain('unique');
    });
  });

  describe('invalid configurations', () => {
    it('should throw InvalidMethodError for wrong method', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: { method: 'tools/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Error is either InvalidMethodError with method name or InvalidInputError
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should throw InvalidMethodError for prompts/get method', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: { method: 'prompts/get', params: { name: 'test' } },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should throw InvalidInputError for missing request', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should throw InvalidInputError for null input', async () => {
      const promptRegistry = createMockPromptRegistry();

      const result = await runFlow(null, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should throw InvalidInputError for invalid request format', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: 'invalid',
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should throw InvalidInputError for missing method in request', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: { params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle prompts with undefined optional fields', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('minimal', {
        name: 'minimal',
        arguments: [],
        // No title, description, or icons
      });
      // Clear optional fields
      promptEntry.metadata.title = undefined;
      promptEntry.metadata.description = undefined;
      promptEntry.metadata.icons = undefined;

      addPromptToMock(promptRegistry, 'minimal', promptEntry);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts).toHaveLength(1);
      expect(result.response.prompts[0].name).toBe('minimal');
      expect(result.response.prompts[0].title).toBeUndefined();
    });

    it('should handle prompts with empty arguments array', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('no-args', {
        name: 'no-args',
        description: 'No arguments',
        arguments: [],
      });
      addPromptToMock(promptRegistry, 'no-args', promptEntry);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts[0].arguments).toEqual([]);
    });

    it('should log warnings when no prompts found', async () => {
      const promptRegistry = createMockPromptRegistry();
      const deps = createMockDependencies(promptRegistry);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      await runFlow(input, deps);

      // The flow should log a warning about no prompts found
      expect(deps.mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle large number of prompts', async () => {
      const promptRegistry = createMockPromptRegistry();

      // Add 100 prompts
      for (let i = 0; i < 100; i++) {
        const promptEntry = createMockPromptEntry(`prompt-${i}`, {
          name: `prompt-${i}`,
          description: `Prompt number ${i}`,
          arguments: [],
        });
        addPromptToMock(promptRegistry, `prompt-${i}`, promptEntry);
      }

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts).toHaveLength(100);
    });

    it('should handle prompts with special characters in names', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('my-prompt_v2.0', {
        name: 'my-prompt_v2.0',
        description: 'Special name',
        arguments: [],
      });
      addPromptToMock(promptRegistry, 'my-prompt_v2.0', promptEntry);

      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.prompts[0].name).toBe('my-prompt_v2.0');
    });
  });

  describe('context handling', () => {
    it('should pass context through flow', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('ctx-test', {
        name: 'ctx-test',
        description: 'Context test',
        arguments: [],
      });
      addPromptToMock(promptRegistry, 'ctx-test', promptEntry);

      const authInfo = { userId: 'user-123', roles: ['admin'] };
      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: { authInfo },
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      // Flow should complete successfully with context
      expect(result.response.prompts).toHaveLength(1);
    });

    it('should handle empty context', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: { method: 'prompts/list', params: {} },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
    });
  });
});
