/**
 * Elicitation Types - MCP Elicitation Support
 *
 * Types for requesting interactive user input from MCP clients during
 * tool or agent execution.
 */

import { ZodType } from 'zod';
import { Infer } from '../types/zod.types';

/**
 * Default timeout for elicitation requests (5 minutes).
 */
export const DEFAULT_ELICIT_TTL = 300000;

/**
 * Possible statuses for an elicitation result.
 *
 * - `accept`: User submitted/accepted the elicitation (MCP SDK calls this 'accept')
 * - `cancel`: User cancelled the elicitation
 * - `decline`: User declined to provide information
 */
export type ElicitStatus = 'accept' | 'cancel' | 'decline';

/**
 * Result of an elicitation request.
 *
 * @template T - The type of the content when status is 'accept'
 */
export interface ElicitResult<T = unknown> {
  /**
   * The user's action in response to the elicitation.
   * Valid values: 'accept' | 'cancel' | 'decline' (see ElicitStatus)
   */
  status: ElicitStatus;

  /**
   * The validated content from the user's response.
   * Only present when status is 'accept'.
   */
  content?: T;
}

/**
 * Elicitation mode.
 *
 * - `form`: Display a form to collect structured input (most common)
 * - `url`: Redirect user to a URL for out-of-band interaction (OAuth, payments)
 */
export type ElicitMode = 'form' | 'url';

/**
 * Options for elicitation requests.
 */
export interface ElicitOptions {
  /**
   * The elicitation mode.
   * @default 'form'
   */
  mode?: ElicitMode;

  /**
   * Timeout in milliseconds before the elicitation request times out.
   * On timeout, an ElicitationTimeoutError is thrown to kill execution.
   * @default 300000 (5 minutes)
   */
  ttl?: number;

  /**
   * Unique identifier for URL-mode elicitation.
   * Required for URL mode to track completion via notifications.
   */
  elicitationId?: string;
}

/**
 * Typed elicitation result that preserves the schema type.
 *
 * @template T - Zod schema type
 */
export type TypedElicitResult<T extends ZodType> = ElicitResult<Infer<T>>;

/**
 * MCP SDK elicitation result format.
 *
 * This represents the raw format from MCP SDK where `action` is used instead of `status`.
 * Used in transport layer when handling responses from the client.
 */
export interface McpElicitResult {
  /** The user's action (MCP SDK uses 'action' instead of 'status') */
  action: ElicitStatus;

  /** The content from the user's response (only present when action is 'accept') */
  content?: unknown;
}

/**
 * Internal pending elicit tracking structure.
 * Used by transport adapters to manage pending elicitation requests.
 */
export interface PendingElicit<T = unknown> {
  /** Unique identifier for this elicit request */
  elicitId: string;

  /** Handle for the timeout timer */
  timeoutHandle: ReturnType<typeof setTimeout>;

  /** Resolve function to complete the elicit promise */
  resolve: (result: ElicitResult<T>) => void;

  /** Reject function to fail the elicit promise */
  reject: (err: unknown) => void;
}

/**
 * Pending elicitation fallback record.
 *
 * Stores context needed to re-invoke the tool when the result arrives
 * via the sendElicitationResult tool. Used for clients that don't support
 * the standard MCP elicitation protocol.
 */
export interface PendingElicitFallback {
  /** Unique identifier for this elicit request */
  elicitId: string;

  /** Session ID that initiated the elicitation */
  sessionId: string;

  /** Name of the tool that requested elicitation */
  toolName: string;

  /** Original input arguments passed to the tool */
  toolInput: unknown;

  /** Message displayed to the user */
  elicitMessage: string;

  /** JSON Schema for the expected response */
  elicitSchema: Record<string, unknown>;

  /** Timestamp when the elicitation was created */
  createdAt: number;

  /** Absolute timestamp when the elicitation expires */
  expiresAt: number;
}

/**
 * Pre-resolved elicit result for fallback continuation.
 *
 * Stored when sendElicitationResult is called, and retrieved when
 * the tool is re-invoked to provide the elicit result immediately.
 */
export interface ResolvedElicitResult {
  /** Unique identifier for this elicit request */
  elicitId: string;

  /** The elicitation result from the user */
  result: ElicitResult<unknown>;

  /** Timestamp when the result was resolved */
  resolvedAt: number;
}
