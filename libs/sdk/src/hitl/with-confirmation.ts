// file: libs/sdk/src/hitl/with-confirmation.ts
/**
 * withConfirmation Tool Wrapper
 *
 * Higher-order function that wraps tool handlers to require
 * human confirmation before execution.
 */

import type { HitlManager } from './hitl-manager';
import type { RiskLevel, ConfirmationDecision } from './types';

/**
 * Options for withConfirmation wrapper
 */
export interface WithConfirmationOptions {
  /** Risk level for this tool */
  riskLevel?: RiskLevel;
  /** Custom description generator */
  descriptionGenerator?: (args: Record<string, unknown>) => string;
  /** Timeout override (ms) */
  timeout?: number;
  /** Allow user to remember decision */
  allowRemember?: boolean;
  /** Additional context to show user */
  context?: string;
  /** Condition to skip confirmation */
  skipIf?: (args: Record<string, unknown>) => boolean;
  /** Callback when confirmation is denied */
  onDeny?: (args: Record<string, unknown>, decision: ConfirmationDecision) => void;
}

/**
 * Result of a confirmed tool execution
 */
export interface ConfirmedToolResult<T> {
  /** Whether the tool was executed */
  executed: boolean;
  /** The result if executed */
  result?: T;
  /** The confirmation decision */
  decision: ConfirmationDecision;
  /** Error if execution failed */
  error?: Error;
}

/**
 * Wrap a tool handler with confirmation requirement
 *
 * @example
 * ```typescript
 * const deleteUser = withConfirmation(
 *   hitlManager,
 *   'delete-user',
 *   async (args: { userId: string }) => {
 *     await db.deleteUser(args.userId);
 *     return { success: true };
 *   },
 *   {
 *     riskLevel: 'high',
 *     descriptionGenerator: (args) => `Delete user ${args.userId}?`,
 *   }
 * );
 *
 * // When called, will prompt for confirmation
 * const result = await deleteUser({ userId: '123' });
 * if (result.executed) {
 *   console.log('User deleted:', result.result);
 * }
 * ```
 */
export function withConfirmation<TArgs extends Record<string, unknown>, TResult>(
  manager: HitlManager,
  toolName: string,
  handler: (args: TArgs) => Promise<TResult> | TResult,
  options: WithConfirmationOptions = {},
): (args: TArgs) => Promise<ConfirmedToolResult<TResult>> {
  const {
    riskLevel = 'medium',
    descriptionGenerator,
    timeout,
    allowRemember = true,
    context,
    skipIf,
    onDeny,
  } = options;

  return async (args: TArgs): Promise<ConfirmedToolResult<TResult>> => {
    // Check skip condition
    if (skipIf && skipIf(args)) {
      try {
        const result = await handler(args);
        return {
          executed: true,
          result,
          decision: 'approve',
        };
      } catch (error) {
        return {
          executed: false,
          decision: 'approve',
          error: error as Error,
        };
      }
    }

    // Generate description
    const description = descriptionGenerator ? descriptionGenerator(args) : `Execute tool "${toolName}"?`;

    // Request confirmation
    const response = await manager.requestConfirmation(toolName, {
      description,
      riskLevel,
      arguments: args,
      timeout,
      allowRemember,
      context,
    });

    if (response.decision !== 'approve') {
      onDeny?.(args, response.decision);
      return {
        executed: false,
        decision: response.decision,
      };
    }

    // Execute the handler
    try {
      const result = await handler(args);
      manager.updateAuditOutcome(response.requestId, 'success');
      return {
        executed: true,
        result,
        decision: 'approve',
      };
    } catch (error) {
      manager.updateAuditOutcome(response.requestId, 'error', (error as Error).message);
      return {
        executed: false,
        decision: 'approve',
        error: error as Error,
      };
    }
  };
}

/**
 * Create a confirmation-required tool class decorator
 *
 * @example
 * ```typescript
 * @RequiresConfirmation({
 *   riskLevel: 'high',
 *   description: 'Delete all user data',
 * })
 * class DeleteAllDataTool extends ToolEntry {
 *   async execute(args: { confirm: boolean }) {
 *     // This will require confirmation
 *   }
 * }
 * ```
 */
export function RequiresConfirmation(options: WithConfirmationOptions & { description?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function <T extends new (...args: any[]) => object>(constructor: T) {
    return class extends constructor {
      static readonly __hitlOptions = options;
      static readonly __requiresConfirmation = true;
    };
  };
}

/**
 * Check if a class has the RequiresConfirmation decorator
 */
export function hasConfirmationRequirement(target: unknown): boolean {
  return !!(target as { __requiresConfirmation?: boolean }).__requiresConfirmation;
}

/**
 * Get confirmation options from a decorated class
 */
export function getConfirmationOptions(target: unknown): WithConfirmationOptions | undefined {
  return (target as { __hitlOptions?: WithConfirmationOptions }).__hitlOptions;
}

/**
 * Create a batch confirmation wrapper for multiple tools
 */
export function createConfirmationBatch(
  manager: HitlManager,
  tools: Array<{
    name: string;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
    options?: WithConfirmationOptions;
  }>,
): Map<string, (args: Record<string, unknown>) => Promise<ConfirmedToolResult<unknown>>> {
  const wrappedTools = new Map<string, (args: Record<string, unknown>) => Promise<ConfirmedToolResult<unknown>>>();

  for (const tool of tools) {
    wrappedTools.set(tool.name, withConfirmation(manager, tool.name, tool.handler, tool.options));
  }

  return wrappedTools;
}
