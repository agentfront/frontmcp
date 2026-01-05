import { Reference } from '@frontmcp/sdk';
import type { RememberStoreInterface } from './providers/remember-store.interface';
import type { RememberAccessor } from './providers/remember-accessor.provider';
import type { RememberPluginOptions } from './remember.types';
import type { ApprovalStore } from './approval/approval-store.interface';
import type { ApprovalService } from './approval/approval.service';

/**
 * DI token for the underlying storage provider.
 */
export const RememberStoreToken: Reference<RememberStoreInterface> = Symbol(
  'plugin:remember:store',
) as Reference<RememberStoreInterface>;

/**
 * DI token for the plugin configuration.
 */
export const RememberConfigToken: Reference<RememberPluginOptions> = Symbol(
  'plugin:remember:config',
) as Reference<RememberPluginOptions>;

/**
 * DI token for the context-scoped RememberAccessor.
 * Use this to access remember functionality in tools and agents.
 *
 * @example
 * ```typescript
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     const remember = this.get(RememberAccessorToken);
 *     await remember.set('key', 'value');
 *   }
 * }
 * ```
 */
export const RememberAccessorToken: Reference<RememberAccessor> = Symbol(
  'plugin:remember:accessor',
) as Reference<RememberAccessor>;

/**
 * DI token for the approval store.
 */
export const ApprovalStoreToken: Reference<ApprovalStore> = Symbol(
  'plugin:remember:approval-store',
) as Reference<ApprovalStore>;

/**
 * DI token for the approval service.
 * Use this to programmatically manage tool approvals.
 *
 * @example
 * ```typescript
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     const approvalService = this.get(ApprovalServiceToken);
 *     const isApproved = await approvalService.isApproved('dangerous-tool');
 *   }
 * }
 * ```
 */
export const ApprovalServiceToken: Reference<ApprovalService> = Symbol(
  'plugin:remember:approval-service',
) as Reference<ApprovalService>;
