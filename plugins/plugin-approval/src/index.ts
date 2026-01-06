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
 * // Basic usage with auto-detected storage
 * const plugin = ApprovalPlugin.init();
 *
 * // With webhook mode
 * const plugin = ApprovalPlugin.init({
 *   mode: 'webhook',
 *   webhook: {
 *     url: 'https://approval.example.com/webhook',
 *     challengeTtl: 300,
 *   },
 * });
 *
 * // Install into scope
 * await plugin.install(scope);
 *
 * // In tools, use this.approval
 * class MyTool extends ToolContext {
 *   async execute() {
 *     const approved = await this.approval.isApproved('other-tool');
 *     await this.approval.grantSessionApproval('helper-tool');
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
