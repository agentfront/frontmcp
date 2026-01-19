/**
 * Elicitation Error Classes
 *
 * Errors related to MCP elicitation requests.
 */

import { PublicMcpError, InternalMcpError } from './mcp.error';

/**
 * Elicitation not supported error.
 *
 * Thrown when attempting to elicit from a client that does not support
 * elicitation, or when the transport is not available for elicitation.
 */
export class ElicitationNotSupportedError extends PublicMcpError {
  constructor(message = 'Client does not support elicitation') {
    super(message, 'ELICITATION_NOT_SUPPORTED', 400);
  }
}

/**
 * Elicitation fallback required.
 *
 * Thrown when elicitation is requested but the client doesn't support the
 * standard elicitation protocol. This is NOT a failure error - it triggers
 * the fallback flow where the tool returns instructions to the LLM, and
 * the LLM uses the sendElicitationResult tool to continue.
 *
 * This error carries all context needed to re-invoke the tool when
 * the result arrives via sendElicitationResult.
 */
export class ElicitationFallbackRequired extends PublicMcpError {
  constructor(
    /** Unique identifier for this elicitation request */
    public readonly elicitId: string,
    /** Message to display to the user */
    public readonly elicitMessage: string,
    /** JSON Schema for the expected response */
    public readonly schema: Record<string, unknown>,
    /** Name of the tool that requested elicitation */
    public readonly toolName: string,
    /** Original input arguments passed to the tool */
    public readonly toolInput: unknown,
    /** Time-to-live in milliseconds */
    public readonly ttl: number,
  ) {
    super('Elicitation fallback required', 'ELICITATION_FALLBACK', 200);
  }

  override getPublicMessage(): string {
    return this.elicitMessage;
  }
}

/**
 * Elicitation timeout error.
 *
 * Thrown when an elicitation request times out waiting for user response.
 * This error is thrown to kill the tool/agent execution memory and ensure
 * resources are properly cleaned up.
 */
export class ElicitationTimeoutError extends PublicMcpError {
  /** The ID of the timed-out elicitation request */
  readonly elicitId: string;

  /** The TTL that was exceeded (in milliseconds) */
  readonly ttl: number;

  constructor(elicitId: string, ttl: number) {
    super(`Elicitation request timed out after ${ttl}ms`, 'ELICITATION_TIMEOUT', 408);
    this.elicitId = elicitId;
    this.ttl = ttl;
  }

  override getPublicMessage(): string {
    return `Elicitation request timed out. The user did not respond within the allowed time (${Math.round(this.ttl / 1000)} seconds).`;
  }
}

/**
 * Elicitation store not initialized error.
 *
 * Thrown when attempting to access the elicitation store before scope initialization
 * has completed. Callers should await scope.ready before accessing elicitationStore.
 */
export class ElicitationStoreNotInitializedError extends InternalMcpError {
  constructor() {
    super(
      'ElicitationStore not initialized. Ensure scope.ready has resolved before accessing.',
      'ELICITATION_STORE_NOT_INITIALIZED',
    );
  }
}
