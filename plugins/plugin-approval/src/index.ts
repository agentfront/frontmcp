/**
 * @frontmcp/plugin-approval
 *
 * Tool authorization workflow with PKCE webhook security.
 *
 * @module @frontmcp/plugin-approval
 *
 * @example
 * ```typescript
 * import { ApprovalPlugin } from '@frontmcp/plugin-approval';
 *
 * @FrontMcp({
 *   info: { name: 'my-server', version: '1.0.0' },
 *   apps: [MyApp],
 *   plugins: [ApprovalPlugin.init()],
 * })
 * class MyServer {}
 *
 * // In tools, use this.approval with `<app id>:<tool name>` ids
 * class MyTool extends ToolContext {
 *   async execute() {
 *     const approved = await this.approval.isApproved('my-app:other_tool');
 *     await this.approval.grantSessionApproval('my-app:helper_tool');
 *   }
 * }
 * ```
 */

// Main plugin
export {
  default as ApprovalPlugin,
  ApprovalPlugin as ApprovalPluginClass,
  type ApprovalPluginOptions,
} from './approval.plugin';

// Symbols
export { ApprovalStoreToken, ApprovalServiceToken, ChallengeServiceToken } from './approval.symbols';

// Types
export * from './types';

// Stores
export {
  type ApprovalStore,
  type ApprovalQuery,
  type GrantApprovalOptions,
  type RevokeApprovalOptions,
  ApprovalStorageStore,
  type ApprovalStorageStoreOptions,
  createApprovalMemoryStore,
} from './stores';

// Services
export {
  ApprovalService,
  createApprovalService,
  type GrantOptions,
  type RevokeOptions,
  ChallengeService,
  createMemoryChallengeService,
  type ChallengeServiceOptions,
  type CreateChallengeOptions,
} from './services';

// Hooks
export { ApprovalCheckPlugin } from './hooks';

// Context extension (automatically installed, but exported for explicit use)
export { installApprovalContextExtension } from './approval.context-extension';

// Re-export approval utilities from local approval module
export {
  // Errors
  ApprovalError,
  ApprovalRequiredError,
  ApprovalOperationError,
  ApprovalScopeNotAllowedError,
  ApprovalExpiredError,
  ChallengeValidationError,
  // Grantor factories
  userGrantor,
  adminGrantor,
  policyGrantor,
  systemGrantor,
  agentGrantor,
  apiGrantor,
  oauthGrantor,
  testGrantor,
  customGrantor,
  normalizeGrantor,
  // Revoker factories
  userRevoker,
  adminRevoker,
  expiryRevoker,
  sessionEndRevoker,
  policyRevoker,
  normalizeRevoker,
  // Type guards
  isGrantorSource,
  isHumanGrantor,
  isAutoGrantor,
  isDelegatedGrantor,
  isApiGrantor,
} from './approval';
