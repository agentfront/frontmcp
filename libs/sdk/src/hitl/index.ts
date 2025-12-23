// file: libs/sdk/src/hitl/index.ts
/**
 * Human-in-the-Loop Module
 *
 * Provides confirmation, audit logging, and human oversight for tool execution.
 */

// Types
export type {
  ConfirmationDecision,
  RiskLevel,
  ConfirmationRequest,
  ConfirmationResponse,
  RememberedDecision,
  AuditLogEntry,
  BypassRule,
  ConfirmationHandler,
  HitlConfig,
} from './types';

export { DEFAULT_HITL_CONFIG, RISK_LEVEL_CONFIG, compareRiskLevels, isRiskLevelAtOrAbove } from './types';

// Manager
export { HitlManager, createHitlManager, type HitlManagerOptions } from './hitl-manager';

// Wrapper
export {
  withConfirmation,
  RequiresConfirmation,
  hasConfirmationRequirement,
  getConfirmationOptions,
  createConfirmationBatch,
  type WithConfirmationOptions,
  type ConfirmedToolResult,
} from './with-confirmation';
