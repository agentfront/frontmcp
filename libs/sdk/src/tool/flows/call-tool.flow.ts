// tools/flows/call-tool.flow.ts
import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, ToolContext, ToolEntry } from '../../common';
import { z } from 'zod';
import { CallToolRequestSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidMethodError,
  ToolNotFoundError,
  InvalidInputError,
  InvalidOutputError,
  ToolExecutionError,
} from '../../errors';

const inputSchema = z.object({
  request: CallToolRequestSchema,
  ctx: z.any(),
});

const outputSchema = CallToolResultSchema;

const stateSchema = z.object({
  input: z
    .object({
      name: z.string().min(1).max(64),
      arguments: z.object({}).passthrough().optional(),
    })
    .passthrough(),
  authInfo: z.any().optional() as z.ZodType<AuthInfo>,
  tool: z.instanceof(ToolEntry),
  toolContext: z.instanceof(ToolContext),
  // Store the raw executed output for plugins to see
  rawOutput: z.any().optional(),
  output: outputSchema,
});

const plan = {
  pre: ['parseInput', 'findTool', 'createToolCallContext', 'acquireQuota', 'acquireSemaphore'],
  execute: ['validateInput', 'execute', 'validateOutput'],
  finalize: ['releaseSemaphore', 'releaseQuota', 'finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'tools:call-tool': FlowRunOptions<
      CallToolFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'tools:call-tool' as const;
const { Stage } = FlowHooksOf<'tools:call-tool'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class CallToolFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('CallToolFlow');

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

    if (method !== 'tools/call') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'tools/call');
    }

    this.state.set({ input: params, authInfo: ctx.authInfo });
    this.logger.verbose('parseInput:done');
  }

  @Stage('findTool')
  async findTool() {
    this.logger.verbose('findTool:start');
    // TODO: add support for session based tools
    const activeTools = this.scope.tools.getTools(true);
    this.logger.info(`findTool: discovered ${activeTools.length} active tool(s) (including hidden)`);

    const { name } = this.state.required.input;
    const tool = activeTools.find((entry) => {
      return entry.fullName === name || entry.name === name;
    });

    if (!tool) {
      this.logger.warn(`findTool: tool "${name}" not found`);
      throw new ToolNotFoundError(name);
    }

    this.logger = this.logger.child(`CallToolFlow(${name})`);
    this.state.set('tool', tool);
    this.logger.info(`findTool: tool "${name}" found`);
    this.logger.verbose('findTool:done');
  }

  @Stage('createToolCallContext')
  async createToolCallContext() {
    this.logger.verbose('createToolCallContext:start');
    const { ctx } = this.input;
    const { tool, input } = this.state.required;

    try {
      const context = tool.create(input.arguments, ctx);
      const toolHooks = this.scope.hooks.getClsHooks(tool.record.provide).map((hook) => {
        hook.run = async () => {
          return context[hook.metadata.method]();
        };
        return hook;
      });

      this.appendContextHooks(toolHooks);
      context.mark('createToolCallContext');
      this.state.set('toolContext', context);
      this.logger.verbose('createToolCallContext:done');
    } catch (error) {
      this.logger.error('createToolCallContext: failed to create context', error);
      throw new ToolExecutionError(tool.metadata.name, error instanceof Error ? error : undefined);
    }
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    this.logger.verbose('acquireQuota:start');
    // used for rate limiting
    this.state.toolContext?.mark('acquireQuota');
    this.logger.verbose('acquireQuota:done');
  }

  @Stage('acquireSemaphore')
  async acquireSemaphore() {
    this.logger.verbose('acquireSemaphore:start');
    // used for concurrency control
    this.state.toolContext?.mark('acquireSemaphore');
    this.logger.verbose('acquireSemaphore:done');
  }

  @Stage('validateInput')
  async validateInput() {
    this.logger.verbose('validateInput:start');
    const { tool, input } = this.state.required;
    const { toolContext } = this.state;
    if (!toolContext) {
      return;
    }
    toolContext.mark('validateInput');

    try {
      toolContext.input = tool.parseInput(input);
      this.logger.verbose('validateInput:done');
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new InvalidInputError('Invalid tool input', err.errors);
      }

      this.logger.error('validateInput: failed to parse input', err);
      throw new InvalidInputError('Unknown error occurred when trying to parse input');
    }
  }

  @Stage('execute')
  async execute() {
    this.logger.verbose('execute:start');
    const toolContext = this.state.toolContext;
    if (!toolContext) {
      return;
    }
    toolContext.mark('execute');

    try {
      toolContext.output = await toolContext.execute(toolContext.input);
      this.logger.verbose('execute:done');
    } catch (error) {
      this.logger.error('execute: tool execution failed', error);
      throw new ToolExecutionError(
        this.state.tool?.metadata.name || 'unknown',
        error instanceof Error ? error : undefined,
      );
    }
  }

  @Stage('validateOutput')
  async validateOutput() {
    this.logger.verbose('validateOutput:start');
    const { toolContext } = this.state;
    if (!toolContext) {
      return;
    }
    toolContext.mark('validateOutput');

    // Store the RAW output for plugins (cache, PII, etc.) to inspect
    this.state.set('rawOutput', toolContext.output);

    this.logger.verbose('validateOutput:done');
  }

  @Stage('releaseSemaphore')
  async releaseSemaphore() {
    this.logger.verbose('releaseSemaphore:start');
    // release concurrency control
    this.state.toolContext?.mark('releaseSemaphore');
    this.logger.verbose('releaseSemaphore:done');
  }

  @Stage('releaseQuota')
  async releaseQuota() {
    this.logger.verbose('releaseQuota:start');
    // release rate limiting
    this.state.toolContext?.mark('releaseQuota');
    this.logger.verbose('releaseQuota:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { tool, rawOutput } = this.state;

    if (!tool) {
      this.logger.error('finalize: tool not found in state');
      throw new ToolExecutionError('unknown', new Error('Tool not found in state'));
    }

    if (rawOutput === undefined) {
      this.logger.error('finalize: tool output not found in state');
      throw new ToolExecutionError(tool.metadata.name, new Error('Tool output not found'));
    }

    // Parse and construct the MCP-compliant output using safeParseOutput
    const parseResult = tool.safeParseOutput(rawOutput);

    if (!parseResult.success) {
      // add support for request id in error messages
      this.logger.error('finalize: output validation failed', {
        tool: tool.metadata.name,
        errors: parseResult.error,
      });

      // Use InvalidOutputError, which hides internal details in production
      throw new InvalidOutputError();
    }

    // Respond with the properly formatted MCP result
    this.respond(parseResult.data);
    this.logger.verbose('finalize:done');
  }
}
