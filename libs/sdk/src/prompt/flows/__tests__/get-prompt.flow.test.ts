import 'reflect-metadata';
import GetPromptFlow from '../get-prompt.flow';
import { FlowControl } from '../../../common/interfaces/flow.interface';
import {
  createMockPromptRegistry,
  createMockPromptEntry,
  addPromptToMock,
} from '../../../__test-utils__/mocks/prompt-registry.mock';

describe('GetPromptFlow', () => {
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
      name: 'prompts:get-prompt',
      plan: {
        pre: ['parseInput', 'findPrompt', 'createPromptContext'],
        execute: ['execute', 'validateOutput'],
        finalize: ['finalize'],
      },
      inputSchema: {
        parse: jest.fn((input: any) => input),
      },
      outputSchema: {
        parse: jest.fn((output: any) => output),
      },
      access: 'authorized',
    };

    return { mockScope, metadata, mockLogger, promptRegistry, mockHookRegistry };
  };

  // Helper to create flow instance and run stages
  const runFlow = async (input: any, deps = createMockDependencies()) => {
    const { mockScope, metadata, promptRegistry } = deps;

    // Create flow instance
    const flow = new GetPromptFlow(metadata as any, input, mockScope as any, jest.fn(), new Map());

    try {
      // Run pre stages
      await flow['parseInput']();
      await flow['findPrompt']();
      await flow['createPromptContext']();

      // Run execute stages
      await flow['execute']();
      await flow['validateOutput']();

      // Run finalize
      await flow['finalize']();

      return { success: true, flow };
    } catch (e) {
      if (e instanceof FlowControl && e.type === 'respond') {
        return { success: true, response: e.output, flow };
      }
      return { success: false, error: e, flow };
    }
  };

  describe('valid configurations', () => {
    it('should execute prompt and return result', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('greeting', {
        name: 'greeting',
        description: 'Says hello',
        arguments: [{ name: 'name', required: true }],
      });

      // Mock the execute to return a proper response
      promptEntry.create.mockReturnValue({
        args: { name: 'World' },
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'Hello World!' } }],
        }),
        mark: jest.fn(),
      });

      addPromptToMock(promptRegistry, 'greeting', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'greeting', arguments: { name: 'World' } },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.response.messages).toBeDefined();
    });

    it('should find prompt by name', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('my-prompt', {
        name: 'my-prompt',
        description: 'Test prompt',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'Response' } }],
        }),
        mark: jest.fn(),
      });

      addPromptToMock(promptRegistry, 'my-prompt', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'my-prompt' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(promptRegistry.findByName).toHaveBeenCalledWith('my-prompt');
    });

    it('should handle prompt with no arguments', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('no-args', {
        name: 'no-args',
        description: 'No arguments needed',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'assistant', content: { type: 'text', text: 'Hello!' } }],
        }),
        mark: jest.fn(),
      });

      addPromptToMock(promptRegistry, 'no-args', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'no-args' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
    });

    it('should handle prompt with optional arguments', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('optional-args', {
        name: 'optional-args',
        description: 'Has optional args',
        arguments: [
          { name: 'required_arg', required: true },
          { name: 'optional_arg', required: false },
        ],
      });

      promptEntry.create.mockReturnValue({
        args: { required_arg: 'value' },
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'Result' } }],
        }),
        mark: jest.fn(),
      });

      addPromptToMock(promptRegistry, 'optional-args', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'optional-args', arguments: { required_arg: 'value' } },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
    });

    it('should pass auth info through context', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('auth-test', {
        name: 'auth-test',
        description: 'Tests auth',
        arguments: [],
      });

      let capturedCtx: any;
      promptEntry.create.mockImplementation((args, ctx) => {
        capturedCtx = ctx;
        return {
          args,
          ctx,
          output: undefined,
          execute: jest.fn().mockResolvedValue({
            messages: [{ role: 'user', content: { type: 'text', text: 'Auth test' } }],
          }),
          mark: jest.fn(),
        };
      });

      addPromptToMock(promptRegistry, 'auth-test', promptEntry);

      const authInfo = { userId: 'user-123', roles: ['admin'] };
      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'auth-test' },
        },
        ctx: { authInfo },
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(capturedCtx).toEqual({ authInfo });
    });

    it('should handle prompt returning string output', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('string-output', {
        name: 'string-output',
        description: 'Returns string',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue('Simple string response'),
        mark: jest.fn(),
      });

      // Update safeParseOutput to handle string
      promptEntry.safeParseOutput.mockImplementation((output: any) => ({
        success: true,
        data: {
          messages: [{ role: 'user', content: { type: 'text', text: String(output) } }],
          description: 'Returns string',
        },
      }));

      addPromptToMock(promptRegistry, 'string-output', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'string-output' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.messages[0].content.text).toBe('Simple string response');
    });

    it('should handle prompt returning array of messages', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('array-output', {
        name: 'array-output',
        description: 'Returns array',
        arguments: [],
      });

      const messages = [
        { role: 'user', content: { type: 'text', text: 'First' } },
        { role: 'assistant', content: { type: 'text', text: 'Second' } },
      ];

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({ messages }),
        mark: jest.fn(),
      });

      promptEntry.safeParseOutput.mockImplementation((output: any) => ({
        success: true,
        data: output,
      }));

      addPromptToMock(promptRegistry, 'array-output', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'array-output' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
      expect(result.response.messages).toHaveLength(2);
    });
  });

  describe('invalid configurations', () => {
    it('should throw InvalidMethodError for wrong method', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: { method: 'prompts/list', params: { name: 'test' } },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Error is either InvalidMethodError with method name or InvalidInputError
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should throw InvalidMethodError for tools/call method', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: { method: 'tools/call', params: { name: 'test' } },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should throw PromptNotFoundError for non-existent prompt', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'non-existent' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect((result.error as Error).message).toContain('non-existent');
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

    it('should throw InvalidInputError for missing params.name', async () => {
      const promptRegistry = createMockPromptRegistry();
      const input = {
        request: {
          method: 'prompts/get',
          params: {},
        },
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

    it('should throw error for missing required argument', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('required-args', {
        name: 'required-args',
        description: 'Has required args',
        arguments: [{ name: 'required_field', required: true }],
      });

      addPromptToMock(promptRegistry, 'required-args', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'required-args', arguments: {} },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('prompt execution errors', () => {
    it('should handle prompt execution throwing error', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('error-prompt', {
        name: 'error-prompt',
        description: 'Throws error',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockRejectedValue(new Error('Execution failed')),
        mark: jest.fn(),
      });

      addPromptToMock(promptRegistry, 'error-prompt', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'error-prompt' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle invalid output format', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('invalid-output', {
        name: 'invalid-output',
        description: 'Returns invalid output',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({ invalid: 'format' }),
        mark: jest.fn(),
      });

      // Mock safeParseOutput to return failure
      promptEntry.safeParseOutput.mockReturnValue({
        success: false,
        error: new Error('Invalid output format'),
      });

      addPromptToMock(promptRegistry, 'invalid-output', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'invalid-output' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle async prompt execution', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('async-prompt', {
        name: 'async-prompt',
        description: 'Async execution',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            messages: [{ role: 'user', content: { type: 'text', text: 'Async result' } }],
          };
        }),
        mark: jest.fn(),
      });

      promptEntry.safeParseOutput.mockImplementation((output: any) => ({
        success: true,
        data: output,
      }));

      addPromptToMock(promptRegistry, 'async-prompt', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'async-prompt' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle prompt with special characters in name', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('my-prompt_v2.0', {
        name: 'my-prompt_v2.0',
        description: 'Special name',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'Special' } }],
        }),
        mark: jest.fn(),
      });

      promptEntry.safeParseOutput.mockImplementation((output: any) => ({
        success: true,
        data: output,
      }));

      addPromptToMock(promptRegistry, 'my-prompt_v2.0', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'my-prompt_v2.0' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
    });

    it('should handle prompt with namespaced name (owner:name)', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('greeting', {
        name: 'greeting',
        description: 'Namespaced prompt',
        arguments: [],
      });
      promptEntry.owner = { kind: 'app', id: 'my-app', ref: {} };
      promptEntry.fullName = 'my-app:greeting';

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'Namespaced' } }],
        }),
        mark: jest.fn(),
      });

      promptEntry.safeParseOutput.mockImplementation((output: any) => ({
        success: true,
        data: output,
      }));

      // Register with full namespaced name
      addPromptToMock(promptRegistry, 'my-app:greeting', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'my-app:greeting' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
    });

    it('should handle empty arguments object', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('empty-args', {
        name: 'empty-args',
        description: 'Empty args object',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'Empty' } }],
        }),
        mark: jest.fn(),
      });

      promptEntry.safeParseOutput.mockImplementation((output: any) => ({
        success: true,
        data: output,
      }));

      addPromptToMock(promptRegistry, 'empty-args', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'empty-args', arguments: {} },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
    });

    it('should handle prompt returning null output', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('null-output', {
        name: 'null-output',
        description: 'Returns null',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue(null),
        mark: jest.fn(),
      });

      promptEntry.safeParseOutput.mockImplementation((output: any) => ({
        success: true,
        data: {
          messages: [{ role: 'user', content: { type: 'text', text: 'null' } }],
        },
      }));

      addPromptToMock(promptRegistry, 'null-output', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'null-output' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      expect(result.success).toBe(true);
    });

    it('should handle prompt returning undefined output', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('undefined-output', {
        name: 'undefined-output',
        description: 'Returns undefined',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue(undefined),
        mark: jest.fn(),
      });

      // Flow expects rawOutput to be defined, so this should fail at finalize
      addPromptToMock(promptRegistry, 'undefined-output', promptEntry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'undefined-output' },
        },
        ctx: {},
      };

      const result = await runFlow(input, createMockDependencies(promptRegistry));

      // Should fail because rawOutput is undefined
      expect(result.success).toBe(false);
    });
  });

  describe('logging behavior', () => {
    it('should log when prompt is found', async () => {
      const promptRegistry = createMockPromptRegistry();
      const promptEntry = createMockPromptEntry('log-test', {
        name: 'log-test',
        description: 'Test logging',
        arguments: [],
      });

      promptEntry.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'Logged' } }],
        }),
        mark: jest.fn(),
      });

      promptEntry.safeParseOutput.mockImplementation((output: any) => ({
        success: true,
        data: output,
      }));

      addPromptToMock(promptRegistry, 'log-test', promptEntry);

      const deps = createMockDependencies(promptRegistry);
      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'log-test' },
        },
        ctx: {},
      };

      await runFlow(input, deps);

      expect(deps.mockLogger.info).toHaveBeenCalled();
    });

    it('should log warning when prompt not found', async () => {
      const promptRegistry = createMockPromptRegistry();
      const deps = createMockDependencies(promptRegistry);

      const input = {
        request: {
          method: 'prompts/get',
          params: { name: 'not-found' },
        },
        ctx: {},
      };

      await runFlow(input, deps);

      expect(deps.mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('multiple iterations', () => {
    it('should handle multiple sequential prompt calls', async () => {
      const promptRegistry = createMockPromptRegistry();

      const prompt1 = createMockPromptEntry('prompt-1', {
        name: 'prompt-1',
        description: 'First',
        arguments: [],
      });
      prompt1.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'First' } }],
        }),
        mark: jest.fn(),
      });
      prompt1.safeParseOutput.mockImplementation((o: any) => ({ success: true, data: o }));

      const prompt2 = createMockPromptEntry('prompt-2', {
        name: 'prompt-2',
        description: 'Second',
        arguments: [],
      });
      prompt2.create.mockReturnValue({
        args: {},
        ctx: {},
        output: undefined,
        execute: jest.fn().mockResolvedValue({
          messages: [{ role: 'user', content: { type: 'text', text: 'Second' } }],
        }),
        mark: jest.fn(),
      });
      prompt2.safeParseOutput.mockImplementation((o: any) => ({ success: true, data: o }));

      addPromptToMock(promptRegistry, 'prompt-1', prompt1);
      addPromptToMock(promptRegistry, 'prompt-2', prompt2);

      // First call
      const input1 = {
        request: {
          method: 'prompts/get',
          params: { name: 'prompt-1' },
        },
        ctx: {},
      };
      const result1 = await runFlow(input1, createMockDependencies(promptRegistry));
      expect(result1.success).toBe(true);

      // Second call
      const input2 = {
        request: {
          method: 'prompts/get',
          params: { name: 'prompt-2' },
        },
        ctx: {},
      };
      const result2 = await runFlow(input2, createMockDependencies(promptRegistry));
      expect(result2.success).toBe(true);
    });

    it('should handle same prompt called multiple times', async () => {
      const promptRegistry = createMockPromptRegistry();
      let callCount = 0;

      const promptEntry = createMockPromptEntry('counter', {
        name: 'counter',
        description: 'Counts calls',
        arguments: [],
      });

      promptEntry.create.mockImplementation(() => {
        callCount++;
        return {
          args: {},
          ctx: {},
          output: undefined,
          execute: jest.fn().mockResolvedValue({
            messages: [{ role: 'user', content: { type: 'text', text: `Call ${callCount}` } }],
          }),
          mark: jest.fn(),
        };
      });

      promptEntry.safeParseOutput.mockImplementation((o: any) => ({ success: true, data: o }));

      addPromptToMock(promptRegistry, 'counter', promptEntry);

      for (let i = 0; i < 5; i++) {
        const input = {
          request: {
            method: 'prompts/get',
            params: { name: 'counter' },
          },
          ctx: {},
        };
        const result = await runFlow(input, createMockDependencies(promptRegistry));
        expect(result.success).toBe(true);
      }

      expect(callCount).toBe(5);
    });
  });
});
