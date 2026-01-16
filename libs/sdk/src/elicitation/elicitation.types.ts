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
 * @template T - The type of the content when status is 'submit'
 */
export interface ElicitResult<T = unknown> {
  /**
   * The user's action in response to the elicitation.
   */
  status: ElicitStatus;

  /**
   * The validated content from the user's response.
   * Only present when status is 'submit'.
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
