/**
 * @frontmcp/plugin-approval - Browser Entry Point
 *
 * Provides the browser-compatible subset of the approval plugin.
 * Only memory-based storage is available in the browser — Redis and Vercel KV are excluded.
 *
 * @packageDocumentation
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

// Stores (memory only)
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

// Context extension
export { installApprovalContextExtension } from './approval.context-extension';

// Approval utilities
export {
  ApprovalError,
  ApprovalRequiredError,
  ApprovalOperationError,
  ApprovalScopeNotAllowedError,
  ApprovalExpiredError,
  ChallengeValidationError,
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
  userRevoker,
  adminRevoker,
  expiryRevoker,
  sessionEndRevoker,
  policyRevoker,
  normalizeRevoker,
  isGrantorSource,
  isHumanGrantor,
  isAutoGrantor,
  isDelegatedGrantor,
  isApiGrantor,
} from './approval';
