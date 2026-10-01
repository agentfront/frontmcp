// file: libs/sdk/src/agent/flows/call-agent.flow.ts

import { AuthorityDeniedError, resolveRequiredScopes } from '@frontmcp/auth';
import { ExecutionTimeoutError, withTimeout, type SemaphoreTicket } from '@frontmcp/guard';
import { z } from '@frontmcp/lazy-zod';
import { CallToolRequestSchema, CallToolResultSchema, type AuthInfo } from '@frontmcp/protocol';

import { completionEventsOf, completionOutputText } from '../../channel/sources/completion-events';
import {
  acquireConcurrencySlots,
  AgentContext,
  AgentEntry,
  buildPartitionContext,
  Flow,
  FlowBase,
  FlowControl,
  FlowHooksOf,
  GLOBAL_RATE_LIMIT_CHECKED,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import {
  AgentCallDepthExceededError,
  AgentExecutionError,
  AgentNotFoundError,
  ElicitationFallbackRequired,
  InvalidInputError,
  InvalidMethodError,
  InvalidOutputError,
  RateLimitError,
} from '../../errors';
import { type EntryClassHooksJoin } from '../../hooks/entry-class-hooks';
import { hooksBoundTo } from '../../hooks/hooks.utils';
import { FlowContextProviders } from '../../provider/flow-context-providers';
import { type SdkAuthInfo } from '../../server/server.types';
import { DEFAULT_MAX_AGENT_CALL_DEPTH, nextAgentCallDepth, runAsAgent } from '../agent-call-chain';

// ============================================================================
// Schemas
// ============================================================================

const inputSchema = z.object({
  request: CallToolRequestSchema,
  // z.any() used because ctx is the MCP SDK's ToolCallExtra type which varies by SDK version
  ctx: z.any(),
  /**
   * Set when the agent's `invoke_<agent>` tool runs this flow. That tool's `tools:call-tool` flow
   * has already applied the agent's authorities, rate limit, concurrency and timeout (they are
   * copied onto the tool), so this flow's stages for them leave the checks to it instead of
   * counting the call twice. Their hooks still run.
   */
  gatedBy: z.literal('tools:call-tool').optional(),
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
  // Progress token from request's _meta (for progress notifications)
  progressToken: z.union([z.string(), z.number()]).optional(),
  // JSON-RPC request ID (for elicitation routing)
  jsonRpcRequestId: z.union([z.string(), z.number()]).optional(),
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
  // Semaphore ticket for concurrency control (set by acquireSemaphore, used by releaseSemaphore)
  semaphoreTicket: z.any().optional(),
  // A timed-out execute() that is still running; its concurrency slot is released when it settles
  abandonedExecution: z.instanceof(Promise).optional(),
  // When execute() started, and the error it ended with (for the completion event)
  executionStartedAt: z.number().optional(),
  executionError: z.any().optional(),
  // The MCP result built from rawOutput (parseOutput), or why it could not be built
  parsedOutput: z.any().optional(),
  outputError: z.any().optional(),
});

// ============================================================================
// Flow Plan
// ============================================================================

const plan = {
  pre: [
    'parseInput',
    'findAgent',
    'checkCallDepth',
    'checkEntryAuthorities',
    'checkAgentAuthorization',
    'createAgentContext',
    'acquireQuota',
    'acquireSemaphore',
  ],
  execute: ['validateInput', 'execute', 'validateOutput'],
  finalize: ['releaseSemaphore', 'releaseQuota', 'parseOutput', 'emitCompletion', 'finalize'],
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

/** The InvalidOutputError that parsing raised, which names the field that did not match, else a bare one. */
function invalidOutputFrom(outputError: unknown): InvalidOutputError {
  return outputError instanceof InvalidOutputError ? outputError : new InvalidOutputError();
}

const name = 'agents:call-agent' as const;

/** Where the hooks an agent class declares join a run: they run on the instance 'createAgentContext' builds. */
export const agentClassHooksJoin: EntryClassHooksJoin = { flow: name, plan, contextStage: 'createAgentContext' };
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

  /** Whether the `invoke_<agent>` tool's flow already applied the agent's gates. */
  private get gatedByToolFlow(): boolean {
    return this.input.gatedBy === 'tools:call-tool';
  }

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
    // Agent ID is the tool name (agents use standard tool names)
    const agentId = toolName;

    let agent: AgentEntry | undefined;
    if (this.scope.agents) {
      agent = this.scope.agents.findById(agentId) ?? this.scope.agents.findByName(agentId);
    }

    // Store agent owner ID in state for hook filtering
    const agentOwnerId = agent?.owner?.id;

    // Extract progressToken from request's _meta (for progress notifications)
    const progressToken = params._meta?.progressToken;

    // Extract JSON-RPC request ID for elicitation routing
    const jsonRpcRequestId = ctx.requestId;

    this.state.set({
      input: params,
      authInfo: ctx.authInfo,
      _agentOwnerId: agentOwnerId,
      progressToken,
      jsonRpcRequestId,
    });
    this.logger.verbose('parseInput:done');
  }

  /**
   * Find the agent in the registry.
   */
  @Stage('findAgent')
  async findAgent() {
    this.logger.verbose('findAgent:start');

    const agents = this.scope.agents;

    if (!agents) {
      this.logger.warn('findAgent: no agent registry available');
      throw new AgentNotFoundError(this.state.required.input.name);
    }

    const activeAgents = agents.getAgents(true);
    this.logger.info(`findAgent: discovered ${activeAgents.length} active agent(s) (including hidden)`);

    const { name: toolName } = this.state.required.input;

    // Agent ID is the tool name (agents use standard tool names)
    const agentId = toolName;

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
   * Refuse a call from inside another agent's run when the chain of running agents is already as deep
   * as one of them allows (`swarm.maxCallDepth`, 3 by default). A call from a client starts a chain.
   */
  @Stage('checkCallDepth')
  async checkCallDepth() {
    const next = nextAgentCallDepth();
    if (!next || next.depth <= next.limit) return;
    const agent = this.state.required.agent;
    this.logger.warn(`checkCallDepth: agent call ${next.depth} exceeds maxCallDepth ${next.limit}`);
    throw new AgentCallDepthExceededError(
      agent.id,
      next.chain.map((running) => running.id),
      next.limit,
    );
  }

  /**
   * Check entry-level authorities (RBAC/ABAC/ReBAC) declared in agent metadata.
   * Hookable: developers can use Will/Did/Around on 'checkEntryAuthorities'.
   * Skips silently if no authorities engine is configured or no authorities on the agent.
   */
  @Stage('checkEntryAuthorities')
  async checkEntryAuthorities() {
    this.logger.verbose('checkEntryAuthorities:start');
    if (this.gatedByToolFlow) {
      this.logger.verbose('checkEntryAuthorities:skip (checked by the invoke tool flow)');
      return;
    }
    const engine = this.scope.authoritiesEngine;
    const ctxBuilder = this.scope.authoritiesContextBuilder;
    if (!engine || !ctxBuilder) {
      this.logger.verbose('checkEntryAuthorities:skip (no engine configured)');
      return;
    }

    const agent = this.state.agent;
    if (!agent) return;

    const metadata = agent.metadata as unknown as Record<string, unknown>;
    const authorities = metadata['authorities'];
    if (!authorities) {
      this.logger.verbose('checkEntryAuthorities:skip (no authorities on agent)');
      return;
    }

    const authInfo = this.state.authInfo ?? {};
    const stateInput = this.state.input;
    const input = ((stateInput as Record<string, unknown>)?.['arguments'] ?? stateInput ?? {}) as Record<
      string,
      unknown
    >;

    const evalCtx = ctxBuilder.build(authInfo as Record<string, unknown>, input);
    const result = await engine.evaluate(authorities as import('@frontmcp/auth').AuthoritiesMetadata, evalCtx);

    if (!result.granted) {
      let requiredScopes: string[] | undefined;
      const scopeMapping = this.scope.authoritiesScopeMapping;
      if (scopeMapping && result.denial) {
        requiredScopes = resolveRequiredScopes(
          result.denial,
          scopeMapping,
          authorities as import('@frontmcp/auth').AuthoritiesMetadata,
        );
      }

      throw new AuthorityDeniedError({
        entryType: 'Agent',
        entryName: agent.fullName || agent.name,
        deniedBy: result.deniedBy ?? 'policy denied',
        denial: result.denial,
        requiredScopes,
      });
    }

    this.logger.verbose('checkEntryAuthorities:done');
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
    const progressToken = this.state.progressToken;
    const authInfo = this.state.authInfo;

    try {
      // The agent's own provider hierarchy wins over the scope-level instances in the flow deps, as
      // for a tool: `this.context` and CONTEXT-scoped providers then resolve inside the agent.
      const sessionKey = authInfo?.sessionId ?? 'anonymous';
      const agentViews = await agent.providers.buildViews(sessionKey, new Map(this.deps), this.scope.providers);
      const contextProviders = new FlowContextProviders(agent.providers, agentViews.context);
      const context = agent.create(input.arguments, { ...ctx, progressToken, contextProviders });
      // `authorities.pipes` may be async: run them before any hook or execute() reads `this.auth`.
      await context.loadAuthContext();
      this.appendContextHooks(hooksBoundTo(this.scope.hooks.getClsHooks(agent.record.provide), context));
      context.mark('createAgentContext');

      // Wire transport to FrontMcpContext for elicitation support
      // The transport is stored in authInfo.transport by the local adapter
      const frontmcpContext = context.tryGetContext();
      const sdkAuthInfo = authInfo as SdkAuthInfo | undefined;
      // Without a JSON-RPC request id this transport can't route an elicitation, so the one the
      // caller's flow (tools:call-tool for the agent tool) set on the context stays in place.
      const jsonRpcRequestId = this.state.jsonRpcRequestId;
      if (frontmcpContext && sdkAuthInfo?.transport?.sendElicitRequest && jsonRpcRequestId !== undefined) {
        const transport = sdkAuthInfo.transport;
        // Pass the JSON-RPC request ID for proper elicitation routing
        // The MCP SDK uses this to route messages through the correct SSE stream
        frontmcpContext.setTransport({
          sendElicitRequest: transport.sendElicitRequest.bind(transport),
          type: (transport as { type?: string }).type ?? 'unknown',
          jsonRpcRequestId,
        });
      }

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

    const manager = this.scope.rateLimitManager;
    if (!manager || this.gatedByToolFlow) {
      this.state.agentContext?.mark('acquireQuota');
      this.logger.verbose('acquireQuota:done (no rate limit manager)');
      return;
    }

    const { agent } = this.state.required;
    const context = this.tryGetContext();
    const partitionCtx = buildPartitionContext(context);

    // Check global rate limit, unless http:request already counted this request
    if (!context?.has(GLOBAL_RATE_LIMIT_CHECKED)) {
      const globalResult = await manager.checkGlobalRateLimit(partitionCtx);
      if (!globalResult.allowed) {
        throw new RateLimitError(Math.ceil((globalResult.retryAfterMs ?? 60_000) / 1000));
      }
    }

    // Check per-agent rate limit
    const result = await manager.checkRateLimit(agent.metadata.name, agent.metadata.rateLimit, partitionCtx);
    if (!result.allowed) {
      throw new RateLimitError(Math.ceil((result.retryAfterMs ?? 60_000) / 1000));
    }

    this.state.agentContext?.mark('acquireQuota');
    this.logger.verbose('acquireQuota:done');
  }

  /**
   * Acquire semaphore for concurrency control.
   */
  @Stage('acquireSemaphore')
  async acquireSemaphore() {
    this.logger.verbose('acquireSemaphore:start');

    const manager = this.scope.rateLimitManager;
    if (!manager || this.gatedByToolFlow) {
      this.state.agentContext?.mark('acquireSemaphore');
      this.logger.verbose('acquireSemaphore:done (no rate limit manager)');
      return;
    }

    const { agent } = this.state.required;
    const partitionCtx = buildPartitionContext(this.tryGetContext());
    const ticket = await acquireConcurrencySlots(
      manager,
      agent.metadata.name,
      agent.metadata.concurrency,
      partitionCtx,
    );

    this.state.set('semaphoreTicket', ticket);
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
    this.state.set('executionStartedAt', startTime);
    // Under the invoke tool, its flow already applies `timeout.executeMs` (copied onto the tool) and the
    // scope default. It can't see `execution.timeout`, the agent's own setting, so that one is applied here.
    const timeoutMs = this.gatedByToolFlow
      ? agent.metadata.timeout?.executeMs === undefined
        ? agent.metadata.execution?.timeout
        : undefined
      : (agent.metadata.timeout?.executeMs ??
        agent.metadata.execution?.timeout ??
        this.scope.rateLimitManager?.config?.defaultTimeout?.executeMs);

    // The agent runs a step deeper in the chain of running agents, which `checkCallDepth` reads for
    // the agents it calls in turn.
    const runningAgent = {
      id: agent.id,
      maxCallDepth: agent.metadata.swarm?.maxCallDepth ?? DEFAULT_MAX_AGENT_CALL_DEPTH,
    };
    const running = runAsAgent(runningAgent, async () => {
      agentContext.output = await agentContext.execute(agentContext.input);
    });

    try {
      await (timeoutMs ? withTimeout(() => running, timeoutMs, agent.metadata.name) : running);

      // Track execution metadata
      this.state.set('executionMeta', {
        durationMs: Date.now() - startTime,
      });

      this.logger.verbose('execute:done');
    } catch (error) {
      this.state.set('executionError', error);
      if (error instanceof ExecutionTimeoutError) {
        this.logger.warn('execute: agent execution timed out', {
          agent: agent.metadata.name,
          timeoutMs,
        });
        this.state.set('abandonedExecution', running);
        throw error;
      }
      // Under the invoke tool, its flow reports the agent's error as it reports any tool's, and
      // must see errors it acts on (the elicitation fallback, authority denials) as they are.
      if (this.gatedByToolFlow) throw error;
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
    const ticket = this.state.semaphoreTicket as SemaphoreTicket | undefined;
    if (ticket) {
      const release = async () => {
        try {
          await ticket.release();
          this.logger.verbose('releaseSemaphore: slot released');
        } catch (error) {
          this.logger.warn('releaseSemaphore: failed to release slot', error);
        }
      };
      // A timed-out execute() keeps its slot until it actually stops running
      const abandonedExecution = this.state.abandonedExecution;
      if (abandonedExecution) void abandonedExecution.then(release, release);
      else await release();
    }
    this.state.agentContext?.mark('releaseSemaphore');
    this.logger.verbose('releaseSemaphore:done');
  }

  /**
   * Release the quota.
   */
  @Stage('releaseQuota')
  async releaseQuota() {
    this.logger.verbose('releaseQuota:start');
    // Sliding window counters expire naturally — no release needed
    this.state.agentContext?.mark('releaseQuota');
    this.logger.verbose('releaseQuota:done');
  }

  /**
   * Publish the run's outcome to the scope's agent completions, which `agent-completion` channel
   * sources subscribe to. Runs for every run that reached execute(), whether it succeeded or not.
   * The event names the session that ran the agent, so a channel delivers it only to that session.
   */
  /**
   * Build the MCP result from the agent's output, before the completion event and the response,
   * so both report the same outcome. A failure is recorded, and `finalize` answers it.
   */
  @Stage('parseOutput')
  async parseOutput() {
    const { agent, rawOutput } = this.state;
    if (!agent || rawOutput === undefined) return;
    const parseResult = agent.safeParseOutput(rawOutput);
    if (parseResult.success) this.state.set('parsedOutput', parseResult.data);
    else this.state.set('outputError', parseResult.error);
  }

  @Stage('emitCompletion')
  async emitCompletion() {
    const { agent, agentContext, executionStartedAt, executionError, outputError, authInfo } = this.state;
    if (!agent || executionStartedAt === undefined) return;
    // The call isn't over: it waits for the client's answer (the elicitation fallback) or was ended by
    // a flow's own control signal, and its outcome is published when it is.
    if (executionError instanceof ElicitationFallbackRequired || executionError instanceof FlowControl) return;

    const failure = executionError ?? (outputError !== undefined ? invalidOutputFrom(outputError) : undefined);
    const failed = failure !== undefined;
    const requestId = this.tryGetContext()?.requestId;
    const sessionId = typeof authInfo?.sessionId === 'string' && authInfo.sessionId ? authInfo.sessionId : undefined;
    completionEventsOf(this.scope).agents.emit({
      agentId: agent.id,
      agentName: agent.name,
      status: failed ? 'error' : 'success',
      durationMs: Date.now() - executionStartedAt,
      ...(failed
        ? { error: failure instanceof Error ? failure.message : String(failure) }
        : { output: completionOutputText(agentContext?.output) }),
      ...(requestId ? { runId: requestId } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
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
    const { agent, rawOutput, parsedOutput, outputError, executionMeta } = this.state;

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

    // The MCP-compliant output, built by parseOutput
    if (outputError !== undefined || parsedOutput === undefined) {
      this.logger.error('finalize: output validation failed', {
        agent: agent.metadata.name,
        errors: outputError,
      });
      throw invalidOutputFrom(outputError);
    }

    const result = parsedOutput;

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
      contentParts: Array.isArray(result.content) ? result.content.length : 0,
      contentBytes: Array.isArray(result.content)
        ? result.content.reduce((sum, part) => {
            const str = JSON.stringify(part);
            return (
              sum +
              (typeof Buffer !== 'undefined'
                ? Buffer.byteLength(str, 'utf8')
                : new TextEncoder().encode(str).byteLength)
            );
          }, 0)
        : 0,
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
