/**
 * Elicitation Fallback Helpers
 *
 * Handles fallback logic when clients don't support native MCP elicitation.
 * Used by CallToolFlow to choose between waiting and fire-and-forget patterns.
 *
 * @module elicitation/helpers/fallback.helper
 */

import type { FrontMcpLogger } from '../../common';
import type { Scope } from '../../scope';
import type { FallbackExecutionResult } from '../elicitation.types';
import { DEFAULT_FALLBACK_WAIT_TTL } from '../elicitation.types';
import { ElicitationFallbackRequired, ElicitationTimeoutError } from '../../errors';

/**
 * Dependencies required by fallback handler functions.
 */
export interface FallbackHandlerDeps {
  /** The scope instance with notification service and elicitation store */
  scope: Scope;
  /** Session ID for the current request */
  sessionId: string;
  /** Logger for diagnostic output */
  logger: FrontMcpLogger;
}

/**
 * Check if notifications can be delivered to this session.
 *
 * Returns true if the server is registered in NotificationService.
 * This is used to determine whether to use the waiting pattern
 * (send notification + wait for pub/sub) or fire-and-forget.
 *
 * @param scope - The scope with notification service
 * @param sessionId - The session to check
 * @returns true if notifications can be delivered
 */
export function canDeliverNotifications(scope: Scope, sessionId: string): boolean {
  return scope.notifications.getClientCapabilities(sessionId) !== undefined;
}

/**
 * Send a fallback notification to inform the LLM about elicitation requirements.
 *
 * This notification tells the LLM to call the `sendElicitationResult` tool
 * with the collected user input.
 *
 * @param deps - Dependencies including scope, sessionId, and logger
 * @param error - The ElicitationFallbackRequired error with elicitation details
 */
export function sendFallbackNotification(deps: FallbackHandlerDeps, error: ElicitationFallbackRequired): void {
  const { scope, sessionId, logger } = deps;

  const notificationData = {
    type: 'elicitation_fallback',
    elicitId: error.elicitId,
    message: error.elicitMessage,
    schema: error.schema,
    instructions: `Call sendElicitationResult tool with elicitId: "${error.elicitId}"`,
  };

  scope.notifications.sendNotificationToSession(sessionId, 'notifications/message', {
    level: 'info',
    data: notificationData,
    logger: 'elicitation',
  });

  logger.verbose('sendFallbackNotification: sent notification', {
    elicitId: error.elicitId,
    sessionId: sessionId.slice(0, 20),
  });
}

/**
 * Handle elicitation fallback using the waiting pattern.
 *
 * For streamable-http with notification support:
 * 1. Send notification with fallback instructions BEFORE waiting
 * 2. Subscribe to pub/sub channel for the result
 * 3. Wait for result with timeout
 * 4. Return the actual tool result (not fallback instructions)
 *
 * @param deps - Dependencies including scope, sessionId, and logger
 * @param error - The ElicitationFallbackRequired error with elicitation details
 * @returns Promise that resolves with the tool result when sendElicitationResult is called
 */
export async function handleWaitingFallback(
  deps: FallbackHandlerDeps,
  error: ElicitationFallbackRequired,
): Promise<unknown> {
  const { scope, sessionId, logger } = deps;

  logger.info('handleWaitingFallback: starting waiting fallback', {
    elicitId: error.elicitId,
    toolName: error.toolName,
  });

  // Step 1: Send notification FIRST so the LLM knows to call sendElicitationResult
  sendFallbackNotification(deps, error);

  // Step 2: Wait for the result via pub/sub
  return new Promise<unknown>((resolve, reject) => {
    let resolved = false;
    let unsubscribeFn: (() => Promise<void>) | null = null;
    const ttl = error.ttl || DEFAULT_FALLBACK_WAIT_TTL;

    // Helper to safely unsubscribe
    const safeUnsubscribe = (): void => {
      if (unsubscribeFn) {
        unsubscribeFn().catch(() => {
          // Ignore unsubscribe errors after resolution
        });
        unsubscribeFn = null;
      }
    };

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        safeUnsubscribe();
        logger.warn('handleWaitingFallback: timeout waiting for result', {
          elicitId: error.elicitId,
          ttl,
        });
        // Return an error result instead of throwing
        resolve({
          content: [
            {
              type: 'text',
              text: `Elicitation request timed out after ${Math.round(ttl / 1000)} seconds. The user did not respond in time.`,
            },
          ],
          isError: true,
        });
      }
    }, ttl);

    // Subscribe to fallback results
    scope.elicitationStore
      .subscribeFallbackResult(
        error.elicitId,
        (result: FallbackExecutionResult) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutHandle);
            safeUnsubscribe();

            logger.info('handleWaitingFallback: received result via pub/sub', {
              elicitId: error.elicitId,
              success: result.success,
            });

            if (result.success && result.result !== undefined) {
              resolve(result.result);
            } else {
              // Return error result
              resolve({
                content: [
                  {
                    type: 'text',
                    text: result.error || 'Elicitation fallback execution failed',
                  },
                ],
                isError: true,
              });
            }
          }
        },
        sessionId,
      )
      .then((unsubscribe) => {
        // Store unsubscribe for cleanup on timeout/success
        if (resolved) {
          // Already resolved, clean up immediately
          unsubscribe().catch(() => {
            // Ignore unsubscribe errors after resolution
          });
        } else {
          // Store for later cleanup
          unsubscribeFn = unsubscribe;
        }
      })
      .catch((err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutHandle);
          logger.error('handleWaitingFallback: failed to subscribe', err);
          reject(new ElicitationTimeoutError(error.elicitId, ttl));
        }
      });
  });
}
