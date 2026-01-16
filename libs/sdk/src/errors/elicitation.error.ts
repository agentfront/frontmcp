/**
 * Elicitation Error Classes
 *
 * Errors related to MCP elicitation requests.
 */

import { PublicMcpError } from './mcp.error';

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
