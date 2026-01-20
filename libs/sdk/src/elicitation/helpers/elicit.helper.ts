/**
 * Elicit Helper
 *
 * Extracted helper function for performing elicitation from context classes.
 * This removes duplication between ToolContext and AgentContext.
 *
 * @module elicitation/helpers/elicit.helper
 */

import { ZodType, z } from 'zod';
import { toJSONSchema } from 'zod/v4';
import type { ClientCapabilities } from '../../notification';
import { supportsElicitation } from '../../notification';
import type { ElicitResult, ElicitOptions } from '../elicitation.types';
import { DEFAULT_ELICIT_TTL } from '../elicitation.types';
import { ElicitationNotSupportedError, ElicitationFallbackRequired, ElicitationDisabledError } from '../../errors';
import type { FrontMcpContext } from '../../context';

/**
 * Transport interface for elicitation.
 * Matches the shape exposed by FrontMcpContext.
 */
export interface ElicitTransport {
  elicit<S extends ZodType>(
    message: string,
    requestedSchema: S,
    options?: ElicitOptions,
  ): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>>;
}

/**
 * Dependencies required by the elicit helper.
 */
export interface ElicitHelperDeps {
  /** Session ID for the current request */
  sessionId: string | undefined;

  /** Function to get client capabilities for the session */
  getClientCapabilities: (sessionId: string) => ClientCapabilities | undefined;

  /** Function to get the FrontMcpContext (may be unavailable) */
  tryGetContext: () => FrontMcpContext | undefined;

  /** Entry name for fallback context (tool name or agent name) */
  entryName: string;

  /** Entry input for fallback context (tool input or agent input) */
  entryInput: unknown;

  /**
   * Whether elicitation is enabled in server configuration.
   * When false, calls to elicit() will throw ElicitationDisabledError.
   * @default true
   */
  elicitationEnabled?: boolean;
}

/**
 * Perform an elicitation request.
 *
 * This helper encapsulates the common elicitation logic shared between
 * ToolContext and AgentContext.
 *
 * @param deps - Dependencies for the elicitation
 * @param message - Message to display to the user
 * @param requestedSchema - Zod schema for the expected response
 * @param options - Elicitation options (mode, ttl, elicitationId)
 * @returns The elicitation result
 *
 * @throws {ElicitationDisabledError} If elicitation is disabled in server configuration
 * @throws {ElicitationNotSupportedError} If no session is available
 * @throws {ElicitationNotSupportedError} If transport is not available
 * @throws {ElicitationFallbackRequired} If client doesn't support elicitation (caught by flow)
 */
export async function performElicit<S extends ZodType>(
  deps: ElicitHelperDeps,
  message: string,
  requestedSchema: S,
  options?: ElicitOptions,
): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>> {
  const { sessionId, getClientCapabilities, tryGetContext, entryName, entryInput, elicitationEnabled } = deps;

  // 0. Check if elicitation is enabled in server configuration
  // elicitationEnabled defaults to false if not specified
  if (elicitationEnabled !== true) {
    throw new ElicitationDisabledError();
  }

  // 1. Validate session
  if (!sessionId) {
    throw new ElicitationNotSupportedError('No session available for elicitation');
  }

  // 2. Check for pre-resolved result (fallback re-invocation case)
  const ctx = tryGetContext();
  const preResolved = ctx?.getPreResolvedElicitResult?.();
  if (preResolved) {
    // Clear the pre-resolved result to prevent reuse
    ctx?.clearPreResolvedElicitResult?.();
    return preResolved as ElicitResult<S extends ZodType<infer O> ? O : unknown>;
  }

  // 3. Check client capabilities
  const capabilities = getClientCapabilities(sessionId);
  const mode = options?.mode ?? 'form';

  if (!supportsElicitation(capabilities, mode)) {
    // 4. Fallback: throw error with context for re-invocation
    // This triggers the fallback flow handled by CallToolFlow/CallAgentFlow
    const elicitId = options?.elicitationId ?? `elicit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ttl = options?.ttl ?? DEFAULT_ELICIT_TTL;

    // Convert Zod schema to JSON Schema for the fallback response
    // Wrap in z.object if it's a raw shape (plain object), otherwise use as-is
    const zodSchema =
      requestedSchema instanceof z.ZodType ? requestedSchema : z.object(requestedSchema as z.ZodRawShape);
    const jsonSchema = toJSONSchema(zodSchema) as Record<string, unknown>;

    throw new ElicitationFallbackRequired(elicitId, message, jsonSchema, entryName, entryInput, ttl);
  }

  // 5. Get transport from context
  const transport = ctx?.transport;
  if (!transport) {
    throw new ElicitationNotSupportedError('Transport not available for elicitation');
  }

  // 6. Send elicit request (timeout throws ElicitationTimeoutError)
  return transport.elicit(message, requestedSchema, options);
}

/**
 * Generate a unique elicitation ID.
 *
 * @returns A unique elicitation ID
 */
export function generateElicitationId(): string {
  return `elicit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
