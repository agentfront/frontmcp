/**
 * Context extension that adds `this.approval` to ExecutionContextBase.
 *
 * @module @frontmcp/plugin-approval
 */

import type { ApprovalService } from './services/approval.service';
import { ApprovalServiceToken } from './approval.symbols';

// ─────────────────────────────────────────────────────────────────────────────
// Module Augmentation
// ─────────────────────────────────────────────────────────────────────────────

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    /**
     * Approval service for managing tool authorizations.
     * Provided by @frontmcp/plugin-approval.
     */
    readonly approval: ApprovalService;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Extension
// ─────────────────────────────────────────────────────────────────────────────

let installed = false;

/**
 * Install the approval context extension.
 * Adds `this.approval` property to ExecutionContextBase.
 */
export function installApprovalContextExtension(): void {
  if (installed) return;

  const { ExecutionContextBase } = require('@frontmcp/sdk');

  Object.defineProperty(ExecutionContextBase.prototype, 'approval', {
    get: function () {
      return this.get(ApprovalServiceToken);
    },
    configurable: true,
    enumerable: false,
  });

  installed = true;
}
