// file: libs/sdk/src/errors/agent.errors.ts

import { PublicMcpError, InternalMcpError } from './mcp.error';

// ============================================================================
// Agent Errors
// ============================================================================

/**
 * Agent not found error.
 */
export class AgentNotFoundError extends PublicMcpError {
  readonly agentId: string;

  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND', 404);
    this.agentId = agentId;
  }
}

/**
 * Agent execution error - wraps errors during agent execution.
 */
export class AgentExecutionError extends InternalMcpError {
  readonly agentId: string;
  readonly originalError?: Error;

  constructor(agentId: string, cause?: Error) {
    super(
      cause ? `Agent execution failed: ${cause.message}` : `Agent execution failed: ${agentId}`,
      'AGENT_EXECUTION_FAILED',
    );
    this.agentId = agentId;
    this.originalError = cause;
  }

  override getInternalMessage(): string {
    if (this.originalError?.stack) {
      return `${this.message}\n\nOriginal error:\n${this.originalError.stack}`;
    }
    return this.message;
  }
}

/**
 * Agent loop exceeded error - thrown when an agent exceeds maximum iterations.
 */
export class AgentLoopExceededError extends PublicMcpError {
  readonly agentId: string;
  readonly maxIterations: number;
  readonly actualIterations: number;

  constructor(agentId: string, maxIterations: number, actualIterations?: number) {
    super(`Agent "${agentId}" exceeded maximum iterations (${maxIterations})`, 'AGENT_LOOP_EXCEEDED', 400);
    this.agentId = agentId;
    this.maxIterations = maxIterations;
    this.actualIterations = actualIterations ?? maxIterations;
  }
}

/**
 * Agent timeout error - thrown when an agent exceeds its timeout.
 */
export class AgentTimeoutError extends PublicMcpError {
  readonly agentId: string;
  readonly timeoutMs: number;

  constructor(agentId: string, timeoutMs: number) {
    super(`Agent "${agentId}" execution timed out after ${timeoutMs}ms`, 'AGENT_TIMEOUT', 408);
    this.agentId = agentId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Agent visibility error - thrown when an agent tries to invoke another
 * agent it doesn't have visibility to.
 */
export class AgentVisibilityError extends PublicMcpError {
  readonly requestingAgentId: string;
  readonly targetAgentId: string;

  constructor(requestingAgentId: string, targetAgentId: string) {
    super(
      `Agent "${requestingAgentId}" does not have visibility to agent "${targetAgentId}"`,
      'AGENT_VISIBILITY_DENIED',
      403,
    );
    this.requestingAgentId = requestingAgentId;
    this.targetAgentId = targetAgentId;
  }
}

/**
 * Agent LLM error - thrown when the LLM adapter fails.
 */
export class AgentLlmError extends InternalMcpError {
  readonly agentId: string;
  readonly originalError?: Error;

  constructor(agentId: string, cause?: Error) {
    super(cause ? `Agent LLM error: ${cause.message}` : `Agent LLM error`, 'AGENT_LLM_ERROR');
    this.agentId = agentId;
    this.originalError = cause;
  }

  override getInternalMessage(): string {
    if (this.originalError?.stack) {
      return `${this.message}\n\nOriginal error:\n${this.originalError.stack}`;
    }
    return this.message;
  }
}

/**
 * Agent configuration error - thrown when an agent has invalid configuration.
 */
export class AgentConfigurationError extends PublicMcpError {
  readonly agentId?: string;
  readonly configErrors: string[];

  constructor(message: string, options?: { agentId?: string; errors?: string[] }) {
    super(message, 'AGENT_CONFIGURATION_ERROR', 500);
    this.agentId = options?.agentId;
    this.configErrors = options?.errors ?? [message];
  }
}
