// file: libs/browser/src/hitl/index.ts
/**
 * Human-in-the-Loop Module
 *
 * Browser-specific HiTL implementation for confirmation dialogs,
 * audit logging, and human oversight of tool execution.
 */

// Types (re-exports SDK types + browser-specific)
export * from './types';

// Browser manager
export { BrowserHitlManager, createBrowserHitlManager } from './browser-hitl-manager';

// Re-export SDK utilities for convenience
export {
  HitlManager,
  createHitlManager,
  withConfirmation,
  RequiresConfirmation,
  hasConfirmationRequirement,
  getConfirmationOptions,
  createConfirmationBatch,
  type HitlManagerOptions,
  type WithConfirmationOptions,
  type ConfirmedToolResult,
} from '@frontmcp/sdk/core';
