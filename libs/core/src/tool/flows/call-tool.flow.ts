// tools/flows/call-tool.flow.ts
import {Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, ToolContext, ToolEntry} from '@frontmcp/sdk';
import {z} from 'zod';
import {CallToolRequestSchema, CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';

const inputSchema = z.object({
  request: CallToolRequestSchema,
  ctx: z.any(),
});

const outputSchema = CallToolResultSchema;

const stateSchema = z.object({
  input: z.object({
    name: z.string().min(1).max(64),
    arguments: z.object({}).passthrough().optional(),
  }).passthrough(),
  tool: z.instanceof(ToolEntry),
  toolContext: z.instanceof(ToolContext),
});

const plan = {
  pre: [
    'parseInput',
    'findTool',
    'createToolCallContext',
    'acquireQuota',
    'acquireSemaphore',
  ],
  execute: [
    'validateInput',
    'execute',
    'validateOutput',
  ],
  post: [
    'releaseSemaphore',
    'releaseQuota',
  ],
  finalize: [
    'finalize',
  ],
} as const satisfies FlowPlan<string>;

declare global {
  // noinspection JSUnusedGlobalSymbols
  export interface ExtendFlows {
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
const {Stage} = FlowHooksOf<'tools:call-tool'>(name);

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
    const {request: {method, params},} = inputSchema.parse(this.rawInput);

    if (method !== 'tools/call') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new Error('Invalid method');
    }

    this.state.set({input: params});
    this.logger.verbose('parseInput:done');
  }


  @Stage('findTool')
  async findTool() {
    this.logger.verbose('findTool:start');
    // TODO: add support for session based tools
    const activeTools = this.scope.tools.getTools(true)
    this.logger.info(`findTool: discovered ${activeTools.length} active tool(s) (including hidden)`);

    const {name} = this.state.required.input;
    const tool = activeTools.find(t => t.metadata.name === name);
    if (!tool) {
      const errorMessage = `Tool "${name}" not found`
      this.logger.warn(errorMessage);
      this.fail(new Error(errorMessage))
    }
    this.state.set('tool', tool!);
    this.logger.info(`findTool: tool "${name}" found`);
    this.logger.verbose('findTool:done');
  }

  @Stage('createToolCallContext')
  async createToolCallContext() {
    this.logger.verbose('createToolCallContext:start');
    const {ctx} = this.input
    const {tool, input} = this.state.required;
    const context = tool.create(input, ctx)
    context.input = input;
    context.mark('createToolCallContext')
    this.state.set('toolContext', context)
    this.logger.verbose('createToolCallContext:done');
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    this.logger.verbose('acquireQuota:start');
    // used for rate limiting
    this.state.required.toolContext.mark('acquireQuota')
    this.logger.verbose('acquireQuota:done');
  }

  @Stage('acquireSemaphore')
  async acquireSemaphore() {
    this.logger.verbose('acquireSemaphore:start');
    // used for concurrency control
    this.state.required.toolContext.mark('acquireSemaphore')
    this.logger.verbose('acquireSemaphore:done');
  }


  @Stage('validateInput')
  async validateInput() {
    this.logger.verbose('validateInput:start');
    const {tool, input, toolContext} = this.state.required;
    toolContext.mark('validateInput')
    toolContext.input = tool.inputSchema.parse(input.arguments ?? {});
    this.logger.verbose('validateInput:done');
  }

  @Stage('execute')
  async execute() {
    this.logger.verbose('execute:start');
    const {toolContext} = this.state.required;
    toolContext.mark('execute')
    toolContext.output = await toolContext.execute(toolContext.input)
    this.logger.verbose('execute:done');
  }

  @Stage('validateOutput')
  async validateOutput() {
    this.logger.verbose('validateOutput:start');
    const {tool, toolContext} = this.state.required;
    toolContext.mark('validateOutput')
    toolContext.output = tool.outputSchema.parse(toolContext.output)
    this.logger.verbose('validateOutput:done');
  }

  @Stage('releaseSemaphore')
  async releaseSemaphore() {
    this.logger.verbose('releaseSemaphore:start');
    // release concurrency control
    this.state.required.toolContext.mark('releaseSemaphore')
    this.logger.verbose('releaseSemaphore:done');
  }

  @Stage('releaseQuota')
  async releaseQuota() {
    this.logger.verbose('releaseQuota:start');
    // release rate limiting
    this.state.required.toolContext.mark('releaseQuota')
    this.logger.verbose('releaseQuota:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    this.state.required.toolContext.mark('finalize')
    const {tool, toolContext} = this.state.required;
    const response = tool.outputSchema.parse(toolContext.output);
    this.respond({
      content: [{
        type: 'text',
        text: JSON.stringify(response)
      }],
      structuredContent: response
    })
    this.logger.verbose('finalize:done');
  }
}
