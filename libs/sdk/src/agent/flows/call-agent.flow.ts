// file: libs/sdk/src/agent/flows/call-agent.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, AgentContext, AgentEntry } from '../../common';
import { z } from 'zod';
import { CallToolRequestSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidMethodError,
  InvalidInputError,
  InvalidOutputError,
  AgentNotFoundError,
  AgentExecutionError,
} from '../../errors';
import { Scope } from '../../scope';
import { isAgentToolName, agentIdFromToolName } from '../agent.utils';

// ============================================================================
// Schemas
// ============================================================================

const inputSchema = z.object({
  request: CallToolRequestSchema,
  // z.any() used because ctx is the MCP SDK's ToolCallExtra type which varies by SDK version
  ctx: z.any(),
});

const outputSchema = CallToolResultSchema;

const stateSchema = z.object({
  input: z.looseObject({
    name: z.string().min(1).max(128),
    arguments: z.looseObject({}).optional(),
  }),
  authInfo: z.any().optional() as z.ZodType<AuthInfo>,
  agent: z.instanceof(AgentEntry),
  agentContext: z.instanceof(AgentContext),
  // Store the raw executed output for plugins to see
  rawOutput: z.any().optional(),
  output: outputSchema,
  // Agent owner ID for hook filtering (set during parseInput)
  _agentOwnerId: z.string().optional(),
  // Execution metadata
  executionMeta: z
    .object({
      iterations: z.number().optional(),
      durationMs: z.number().optional(),
      usage: z
        .object({
          promptTokens: z.number().optional(),
          completionTokens: z.number().optional(),
          totalTokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

// ============================================================================
// Flow Plan
// ============================================================================

const plan = {
  pre: ['parseInput', 'findAgent', 'checkAgentAuthorization', 'createAgentContext', 'acquireQuota', 'acquireSemaphore'],
  execute: ['validateInput', 'execute', 'validateOutput'],
  finalize: ['releaseSemaphore', 'releaseQuota', 'finalize'],
} as const satisfies FlowPlan<string>;

// ============================================================================
// Global Flow Type Declaration
// ============================================================================

declare global {
  interface ExtendFlows {
    'agents:call-agent': FlowRunOptions<
      CallAgentFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'agents:call-agent' as const;
const { Stage } = FlowHooksOf<'agents:call-agent'>(name);

// ============================================================================
// Call Agent Flow
// ============================================================================

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class CallAgentFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('CallAgentFlow');

  /**
   * Parse and validate the incoming request.
   */
  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    // NOTE: `any` is intentional - Zod parsing validates these values
    let params: any;
    let ctx: any;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
      ctx = inputData.ctx;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    // Agents are invoked via tools/call with the use-agent:<agent_id> name
    if (method !== 'tools/call') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'tools/call');
    }

    // Find the agent early to get its owner ID for hook filtering
    const { name: toolName } = params;
    const scope = this.scope as Scope;

    // TODO: why we need to extract agentId if we have another stage of findAgent?
    // Extract agent ID from use-agent:<agent_id> pattern or use direct name
    const agentId = agentIdFromToolName(toolName) ?? toolName;

    let agent: AgentEntry | undefined;
    if (scope.agents) {
      agent = scope.agents.findById(agentId) ?? scope.agents.findByName(agentId);
    }

    // Store agent owner ID in state for hook filtering
    const agentOwnerId = agent?.owner?.id;

    this.state.set({ input: params, authInfo: ctx.authInfo, _agentOwnerId: agentOwnerId });
    this.logger.verbose('parseInput:done');
  }

  /**
   * Find the agent in the registry.
   */
  @Stage('findAgent')
  async findAgent() {
    this.logger.verbose('findAgent:start');

    const scope = this.scope as Scope;
    const agents = scope.agents;

    if (!agents) {
      this.logger.warn('findAgent: no agent registry available');
      throw new AgentNotFoundError(this.state.required.input.name);
    }

    const activeAgents = agents.getAgents(true);
    this.logger.info(`findAgent: discovered ${activeAgents.length} active agent(s) (including hidden)`);

    const { name: toolName } = this.state.required.input;

    // Extract agent ID from use-agent:<agent_id> pattern or use direct name
    const agentId = agentIdFromToolName(toolName) ?? toolName;

    // Try to find by ID first, then by name
    let agent: AgentEntry | undefined = agents.findById(agentId);
    if (!agent) {
      agent = agents.findByName(agentId);
    }

    // Also check full name matching
    if (!agent) {
      agent = activeAgents.find((entry) => {
        return entry.fullName === toolName || entry.name === toolName;
      });
    }

    if (!agent) {
      this.logger.warn(`findAgent: agent "${agentId}" not found`);
      throw new AgentNotFoundError(agentId);
    }

    this.logger = this.logger.child(`CallAgentFlow(${agent.name})`);
    this.state.set('agent', agent);
    this.logger.info(`findAgent: agent "${agent.name}" found`);
    this.logger.verbose('findAgent:done');
  }

  /**
   * Check if the agent's parent app is authorized.
   */
  @Stage('checkAgentAuthorization')
  async checkAgentAuthorization() {
    this.logger.verbose('checkAgentAuthorization:start');
    const { agent, authInfo } = this.state;

    // Get authorization from authInfo.extra if available
    const authorization = authInfo?.extra?.['authorization'] as
      | {
          authorizedAppIds?: string[];
          authorizedApps?: Record<string, unknown>;
        }
      | undefined;

    // No auth context = public mode, skip authorization check
    if (!authorization) {
      this.logger.verbose('checkAgentAuthorization:skip (no auth context)');
      return;
    }

    // Get app ID from agent owner (uses existing lineage system)
    const appId = agent?.owner?.id;
    if (!appId) {
      // Agent has no owner = global agent, skip app-level authorization check
      this.logger.verbose('checkAgentAuthorization:skip (no owner)');
      return;
    }

    // Check if app is authorized using existing session structure
    const isAppAuthorized =
      authorization.authorizedAppIds?.includes(appId) || appId in (authorization.authorizedApps || {});

    if (!isAppAuthorized) {
      // For now, agents follow the same authorization rules as tools
      // In the future, we may want to add agent-specific authorization
      this.logger.verbose(`checkAgentAuthorization: app "${appId}" not authorized, but proceeding`);
    }

    this.logger.verbose('checkAgentAuthorization:done');
  }

  /**
   * Create the agent execution context.
   */
  @Stage('createAgentContext')
  async createAgentContext() {
    this.logger.verbose('createAgentContext:start');
    const { ctx } = this.input;
    const { agent, input } = this.state.required;

    try {
      const context = agent.create(input.arguments, ctx);
      const agentHooks = this.scope.hooks.getClsHooks(agent.record.provide).map((hook) => {
        const originalRun = hook.run;
        hook.run = async (hookInput, hookCtx) => {
          const methodName = hook.metadata.method;
          const contextRecord = context as unknown as Record<string, (() => Promise<void>) | undefined>;
          const method = contextRecord[methodName];
          if (method) {
            await method.call(context);
          }
          // Fall back to original run if no method found
          if (!method && originalRun) {
            return originalRun(hookInput, hookCtx);
          }
        };
        return hook;
      });

      this.appendContextHooks(agentHooks);
      context.mark('createAgentContext');
      this.state.set('agentContext', context);
      this.logger.verbose('createAgentContext:done');
    } catch (error) {
      this.logger.error('createAgentContext: failed to create context', error);
      throw new AgentExecutionError(agent.metadata.name, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Acquire quota for rate limiting.
   */
  @Stage('acquireQuota')
  async acquireQuota() {
    this.logger.verbose('acquireQuota:start');
    // Used for rate limiting
    this.state.agentContext?.mark('acquireQuota');
    this.logger.verbose('acquireQuota:done');
  }

  /**
   * Acquire semaphore for concurrency control.
   */
  @Stage('acquireSemaphore')
  async acquireSemaphore() {
    this.logger.verbose('acquireSemaphore:start');
    // Used for concurrency control
    this.state.agentContext?.mark('acquireSemaphore');
    this.logger.verbose('acquireSemaphore:done');
  }

  /**
   * Validate the agent input against its schema.
   */
  @Stage('validateInput')
  async validateInput() {
    this.logger.verbose('validateInput:start');
    const { agent, input } = this.state.required;
    const { agentContext } = this.state;
    if (!agentContext) {
      return;
    }
    agentContext.mark('validateInput');

    try {
      agentContext.input = agent.parseInput(input);
      this.logger.verbose('validateInput:done');
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new InvalidInputError('Invalid agent input', err.issues);
      }

      this.logger.error('validateInput: failed to parse input', err);
      throw new InvalidInputError('Unknown error occurred when trying to parse agent input');
    }
  }

  /**
   * Execute the agent.
   */
  @Stage('execute')
  async execute() {
    this.logger.verbose('execute:start');
    const agentContext = this.state.agentContext;
    const agent = this.state.agent;
    if (!agentContext || !agent) {
      return;
    }
    agentContext.mark('execute');

    const startTime = Date.now();

    try {
      agentContext.output = await agentContext.execute(agentContext.input);

      // Track execution metadata
      this.state.set('executionMeta', {
        durationMs: Date.now() - startTime,
      });

      this.logger.verbose('execute:done');
    } catch (error) {
      this.logger.error('execute: agent execution failed', error);
      throw new AgentExecutionError(agent.metadata.name, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Validate the agent output.
   */
  @Stage('validateOutput')
  async validateOutput() {
    this.logger.verbose('validateOutput:start');
    const { agentContext } = this.state;
    if (!agentContext) {
      return;
    }
    agentContext.mark('validateOutput');

    // Store the RAW output for plugins (cache, PII, etc.) to inspect
    this.state.set('rawOutput', agentContext.output);

    this.logger.verbose('validateOutput:done');
  }

  /**
   * Release the semaphore.
   */
  @Stage('releaseSemaphore')
  async releaseSemaphore() {
    this.logger.verbose('releaseSemaphore:start');
    // Release concurrency control
    this.state.agentContext?.mark('releaseSemaphore');
    this.logger.verbose('releaseSemaphore:done');
  }

  /**
   * Release the quota.
   */
  @Stage('releaseQuota')
  async releaseQuota() {
    this.logger.verbose('releaseQuota:start');
    // Release rate limiting
    this.state.agentContext?.mark('releaseQuota');
    this.logger.verbose('releaseQuota:done');
  }

  /**
   * Finalize the agent response.
   *
   * Validates output and sends the response.
   *
   * Note: This stage runs even when execute fails (as part of cleanup).
   * If rawOutput is undefined, it means an error occurred during execution
   * and the error will be propagated by the flow framework - we should not
   * throw a new error here.
   */
  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { agent, rawOutput, executionMeta } = this.state;

    if (!agent) {
      // No agent found - this is an early failure, just skip finalization
      this.logger.verbose('finalize: skipping (no agent in state)');
      return;
    }

    if (rawOutput === undefined) {
      // No output means execute stage failed - skip finalization
      // The original error will be propagated by the flow framework
      this.logger.verbose('finalize: skipping (no output - execute stage likely failed)');
      return;
    }

    // Parse and construct the MCP-compliant output using safeParseOutput
    const parseResult = agent.safeParseOutput(rawOutput);

    if (!parseResult.success) {
      this.logger.error('finalize: output validation failed', {
        agent: agent.metadata.name,
        errors: parseResult.error,
      });
      throw new InvalidOutputError();
    }

    const result = parseResult.data;

    // Add execution metadata
    if (executionMeta) {
      result._meta = {
        ...result._meta,
        'agent/execution': {
          agentId: agent.id,
          agentName: agent.name,
          durationMs: executionMeta.durationMs,
          iterations: executionMeta.iterations,
          usage: executionMeta.usage,
        },
      };
    }

    // Log the final result being sent
    this.logger.info('finalize: sending response', {
      agent: agent.metadata.name,
      hasContent: Array.isArray(result.content) && result.content.length > 0,
      contentLength: Array.isArray(result.content) ? result.content.length : 0,
      hasStructuredContent: result.structuredContent !== undefined,
      hasMeta: result._meta !== undefined,
      metaKeys: result._meta ? Object.keys(result._meta) : [],
      isError: result.isError,
    });

    // Respond with the properly formatted MCP result
    this.respond(result);
    this.logger.verbose('finalize:done');
  }
}
