// tools/flows/call-tool.flow.ts
import {Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, ToolEntry} from '@frontmcp/sdk';
import {z} from 'zod';
import {CallToolRequestSchema, CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';

const inputSchema = z.object({
  request: CallToolRequestSchema,
  ctx: z.any(),
});

const outputSchema = CallToolResultSchema;

const stateSchema = z.object({
  input: z.object({}).passthrough(),
  tool: z.instanceof(ToolEntry),
});

const plan = {
  pre: [
    'parseInput',
    'findTool',
    'acquireQuota',
    'acquireSemaphore',
  ],
  execute: [
    'createToolCallContext',
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
    'tools:tool-call': FlowRunOptions<
      CallToolFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'tools:tool-call' as const;
const {Stage} = FlowHooksOf<'tools:tool-call'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class CallToolFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ToolsListFlow');

  private sample<T>(arr: T[], n = 5): T[] {
    return arr.slice(0, n);
  }

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');
    const {
      request: {method, params},
    } = inputSchema.parse(this.rawInput);

    if (method !== 'tools/call') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new Error('Invalid method');
    }

    this.logger.verbose('parseInput:done');
  }


  @Stage('findTool')
  async findTool() {

  }

  @Stage('acquireQuota')
  async acquireQuota() {

  }

  @Stage('acquireSemaphore')
  async acquireSemaphore() {

  }

  @Stage('createToolCallContext')
  async createToolCallContext() {

  }

  @Stage('validateInput')
  async validateInput() {

  }

  @Stage('execute')
  async execute() {

  }

  @Stage('validateOutput')
  async validateOutput() {

  }

  @Stage('releaseSemaphore')
  async releaseSemaphore() {

  }

  @Stage('releaseQuota')
  async releaseQuota() {

  }
}
