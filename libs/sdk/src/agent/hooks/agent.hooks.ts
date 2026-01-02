// file: libs/sdk/src/agent/hooks/agent.hooks.ts

import { FlowHooksOf } from '../../common';

/**
 * Hook decorators for the call-agent flow.
 *
 * Use these decorators to hook into agent execution stages:
 *
 * @example
 * ```typescript
 * import { AgentHook } from '@frontmcp/sdk';
 *
 * @Agent({
 *   name: 'my-agent',
 *   // ...
 * })
 * export class MyAgent extends AgentContext {
 *   @AgentHook.Will.execute()
 *   onBeforeExecute() {
 *     this.logger.info('About to execute agent...');
 *   }
 *
 *   @AgentHook.Did.execute()
 *   onAfterExecute() {
 *     this.logger.info('Agent execution completed');
 *   }
 *
 *   @AgentHook.Stage('validateInput')
 *   onValidateInput() {
 *     this.logger.info('Validating input...');
 *   }
 * }
 * ```
 */
const { Will, Did, Stage } = FlowHooksOf<'agents:call-agent'>('agents:call-agent');

/**
 * Agent hook decorators for the call-agent flow.
 *
 * Available hooks:
 * - `AgentHook.Will.*` - Run before a stage
 * - `AgentHook.Did.*` - Run after a stage
 * - `AgentHook.Stage(name)` - Run at a specific stage
 *
 * Stages available:
 * - Pre stages: parseInput, findAgent, checkAgentAuthorization, createAgentContext, acquireQuota, acquireSemaphore
 * - Execute stages: validateInput, execute, validateOutput
 * - Finalize stages: releaseSemaphore, releaseQuota, finalize
 */
export const AgentHook = { Will, Did, Stage };

// Also export individual decorators for flexibility
export { Will as WillAgentStage, Did as DidAgentStage, Stage as OnAgentStage };
