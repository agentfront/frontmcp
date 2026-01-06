/**
 * Approval utilities for tool authorization flows.
 *
 * Provides types, schemas, factories, guards, and errors for implementing
 * tool approval systems with full audit trail support.
 *
 * @module @frontmcp/plugin-approval
 *
 * @example
 * ```typescript
 * import {
 *   ApprovalScope,
 *   ApprovalState,
 *   userGrantor,
 *   testGrantor,
 *   isHumanGrantor,
 *   approvalRecordSchema,
 * } from '@frontmcp/plugin-approval';
 *
 * // Create an approval record
 * const record = {
 *   toolId: 'file_write',
 *   state: ApprovalState.APPROVED,
 *   scope: ApprovalScope.SESSION,
 *   grantedAt: Date.now(),
 *   grantedBy: userGrantor('user-123', 'John Doe'),
 * };
 *
 * // Validate with Zod
 * const validated = approvalRecordSchema.parse(record);
 *
 * // Check grantor type
 * if (isHumanGrantor(record.grantedBy)) {
 *   console.log('Approved by human');
 * }
 * ```
 */

// Types
export {
  // Enums
  ApprovalScope,
  ApprovalState,
  // Types
  type ApprovalContext,
  type ApprovalSourceType,
  type ApprovalMethod,
  type DelegationContext,
  type ApprovalGrantor,
  type RevocationSourceType,
  type RevocationMethod,
  type ApprovalRevoker,
  type ApprovalRecord,
  type ApprovalCategory,
  type RiskLevel,
  type ToolApprovalRequirement,
} from './types';

// Schemas
export {
  approvalScopeSchema,
  approvalStateSchema,
  approvalMethodSchema,
  approvalSourceTypeSchema,
  revocationMethodSchema,
  approvalCategorySchema,
  riskLevelSchema,
  approvalContextSchema,
  delegationContextSchema,
  approvalGrantorSchema,
  approvalRevokerSchema,
  approvalRecordSchema,
  toolApprovalRequirementSchema,
  // Input types
  type ApprovalContextInput,
  type DelegationContextInput,
  type ApprovalGrantorInput,
  type ApprovalRevokerInput,
  type ApprovalRecordInput,
  type ToolApprovalRequirementInput,
} from './schemas';

// Factory functions
export {
  // Grantor factories
  userGrantor,
  policyGrantor,
  adminGrantor,
  systemGrantor,
  agentGrantor,
  apiGrantor,
  oauthGrantor,
  testGrantor,
  customGrantor,
  // Revoker factories
  userRevoker,
  adminRevoker,
  expiryRevoker,
  sessionEndRevoker,
  policyRevoker,
  // Normalization
  normalizeGrantor,
  normalizeRevoker,
} from './factories';

// Guards
export {
  isGrantorSource,
  isHumanGrantor,
  isAutoGrantor,
  isDelegatedGrantor,
  isApiGrantor,
  hasGrantorIdentifier,
  hasGrantorDisplayName,
} from './guards';

// Errors
export {
  ApprovalError,
  ApprovalRequiredError,
  ApprovalOperationError,
  ApprovalScopeNotAllowedError,
  ApprovalExpiredError,
  ChallengeValidationError,
} from './errors';
