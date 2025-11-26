// file: libs/sdk/src/prompt/flows/get-prompt.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, PromptContext, PromptEntry } from '../../common';
import { z } from 'zod';
import { GetPromptRequestSchema, GetPromptResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidMethodError,
  PromptNotFoundError,
  InvalidInputError,
  InvalidOutputError,
  PromptExecutionError,
} from '../../errors';

const inputSchema = z.object({
  request: GetPromptRequestSchema,
  ctx: z.any(),
});

const outputSchema = GetPromptResultSchema;

const stateSchema = z.object({
  input: z.object({
    name: z.string().min(1),
    arguments: z.record(z.string()).optional(),
  }),
  // z.any() used because AuthInfo is a complex external type from @modelcontextprotocol/sdk
  authInfo: z.any().optional() as z.ZodType<AuthInfo>,
  // z.any() used because PromptEntry is a complex abstract class type
  prompt: z.any() as z.ZodType<PromptEntry>,
  // Cached parsed arguments to avoid parsing twice (once in createPromptContext, once in execute)
  parsedArgs: z.record(z.string()).optional(),
  // z.any() used because PromptContext is a complex abstract class type
  promptContext: z.any() as z.ZodType<PromptContext>,
  // z.any() used because prompt output type varies by prompt implementation
  rawOutput: z.any().optional(),
  output: outputSchema,
});

const plan = {
  pre: ['parseInput', 'findPrompt', 'createPromptContext'],
  execute: ['execute', 'validateOutput'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'prompts:get-prompt': FlowRunOptions<
      GetPromptFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'prompts:get-prompt' as const;
const { Stage } = FlowHooksOf<'prompts:get-prompt'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class GetPromptFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('GetPromptFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    let params: any;
    let ctx: any;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
      ctx = inputData.ctx;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.errors : undefined);
    }

    if (method !== 'prompts/get') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'prompts/get');
    }

    this.state.set({
      input: {
        name: params.name,
        arguments: params.arguments,
      },
      authInfo: ctx.authInfo,
    });
    this.logger.verbose('parseInput:done');
  }

  @Stage('findPrompt')
  async findPrompt() {
    this.logger.verbose('findPrompt:start');

    const { name } = this.state.required.input;
    this.logger.info(`findPrompt: looking for prompt with name "${name}"`);

    // Try to find a prompt that matches this name
    const prompt = this.scope.prompts.findByName(name);

    if (!prompt) {
      this.logger.warn(`findPrompt: prompt "${name}" not found`);
      throw new PromptNotFoundError(name);
    }

    // Store prompt owner ID in the flow input for hook filtering.
    // This mutation allows hooks to filter by prompt owner during execution.
    if (prompt.owner) {
      (this.rawInput as any)._promptOwnerId = prompt.owner.id;
    }

    this.logger = this.logger.child(`GetPromptFlow(${name})`);
    this.state.set('prompt', prompt);
    this.logger.info(`findPrompt: prompt "${prompt.name}" found`);
    this.logger.verbose('findPrompt:done');
  }

  @Stage('createPromptContext')
  async createPromptContext() {
    this.logger.verbose('createPromptContext:start');
    const { ctx } = this.input;
    const { prompt, input } = this.state.required;

    try {
      // Parse and validate arguments, cache for reuse in execute stage
      const parsedArgs = prompt.parseArguments(input.arguments);
      this.state.set('parsedArgs', parsedArgs);

      const context = prompt.create(parsedArgs, ctx);
      const promptHooks = this.scope.hooks.getClsHooks(prompt.record.provide).map((hook) => {
        hook.run = async () => {
          return context[hook.metadata.method]();
        };
        return hook;
      });

      this.appendContextHooks(promptHooks);
      context.mark('createPromptContext');
      this.state.set('promptContext', context);
      this.logger.verbose('createPromptContext:done');
    } catch (error) {
      this.logger.error('createPromptContext: failed to create context', error);
      throw new PromptExecutionError(input.name, error instanceof Error ? error : undefined);
    }
  }

  @Stage('execute')
  async execute() {
    this.logger.verbose('execute:start');
    const promptContext = this.state.promptContext;
    const { input, parsedArgs } = this.state.required;

    if (!promptContext) {
      this.logger.warn('execute: promptContext not found, skipping execution');
      return;
    }
    promptContext.mark('execute');

    try {
      // Use cached parsed arguments from createPromptContext stage
      promptContext.output = await promptContext.execute(parsedArgs);
      this.logger.verbose('execute:done');
    } catch (error) {
      this.logger.error('execute: prompt execution failed', error);
      throw new PromptExecutionError(input.name, error instanceof Error ? error : undefined);
    }
  }

  @Stage('validateOutput')
  async validateOutput() {
    this.logger.verbose('validateOutput:start');
    const { promptContext } = this.state;
    if (!promptContext) {
      this.logger.warn('validateOutput: promptContext not found, skipping validation');
      return;
    }
    promptContext.mark('validateOutput');

    // Store the RAW output for plugins to inspect
    this.state.set('rawOutput', promptContext.output);

    this.logger.verbose('validateOutput:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { prompt, rawOutput, input } = this.state;

    if (!prompt) {
      this.logger.error('finalize: prompt not found in state');
      throw new PromptExecutionError('unknown', new Error('Prompt not found in state'));
    }

    if (rawOutput === undefined) {
      this.logger.error('finalize: prompt output not found in state');
      throw new PromptExecutionError(input?.name || 'unknown', new Error('Prompt output not found'));
    }

    // Parse and construct the MCP-compliant output using safeParseOutput
    const parseResult = prompt.safeParseOutput(rawOutput);

    if (!parseResult.success) {
      this.logger.error('finalize: output validation failed', {
        prompt: prompt.metadata.name,
        errors: parseResult.error,
      });

      throw new InvalidOutputError();
    }

    // Respond with the properly formatted MCP result
    this.respond(parseResult.data);
    this.logger.verbose('finalize:done');
  }
}
