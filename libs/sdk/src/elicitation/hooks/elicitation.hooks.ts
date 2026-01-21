/**
 * Elicitation Hook Decorators
 *
 * Provides type-safe hook decorators for intercepting elicitation flows.
 *
 * @module elicitation/hooks/elicitation.hooks
 */

import { FlowHooksOf } from '../../common';

/**
 * Hook decorators for the elicitation:request flow.
 *
 * Use these decorators in plugins or middleware to intercept
 * elicitation request processing at various stages.
 *
 * @example
 * ```typescript
 * import { ElicitationRequestHook } from '@frontmcp/sdk/elicitation';
 *
 * class MyPlugin {
 *   @ElicitationRequestHook.Will('storePendingRecord')
 *   async beforeStorePending(state) {
 *     // Modify state before storing
 *   }
 *
 *   @ElicitationRequestHook.Did('finalize')
 *   async afterFinalize(state) {
 *     // React to completed elicitation request
 *   }
 * }
 * ```
 */
export const ElicitationRequestHook = FlowHooksOf<'elicitation:request'>('elicitation:request');

/**
 * Hook decorators for the elicitation:result flow.
 *
 * Use these decorators in plugins or middleware to intercept
 * elicitation result processing at various stages.
 *
 * @example
 * ```typescript
 * import { ElicitationResultHook } from '@frontmcp/sdk/elicitation';
 *
 * class MyPlugin {
 *   @ElicitationResultHook.Will('publishResult')
 *   async beforePublish(state) {
 *     // Validate or transform result before publishing
 *   }
 *
 *   @ElicitationResultHook.Did('finalize')
 *   async afterFinalize(state) {
 *     // Log or audit completed result handling
 *   }
 * }
 * ```
 */
export const ElicitationResultHook = FlowHooksOf<'elicitation:result'>('elicitation:result');
