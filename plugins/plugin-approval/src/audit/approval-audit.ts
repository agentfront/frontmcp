/**
 * The approval audit trail `enableAudit` turns on: one log line per request, grant, denial, revocation and expiry.
 *
 * @module @frontmcp/plugin-approval
 */

import type { FrontMcpLogger } from '@frontmcp/sdk';

import type { ApprovalContext, ApprovalGrantor, ApprovalRecord, ApprovalRevoker } from '../types';

/**
 * - `approval.requested`: a call had no approval it could use. `state` says what became of it: `pending` or `expired`
 *   (refused), `denied` (refused by a recorded denial or the recheck system), or `approved` (the recheck system
 *   approved it). `via` names the external system asked, if any.
 * - `approval.granted` / `approval.denied`: an approval or a denial was recorded.
 * - `approval.revoked`: an approval was revoked, or a session's approvals were cleared (`count`).
 * - `approval.expired`: the cleanup deleted an expired approval or denial.
 */
export type ApprovalAuditEventType =
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'approval.revoked'
  | 'approval.expired';

/** One audit line's fields. It never carries a session id, a token or a record's `metadata`. */
export interface ApprovalAuditEvent {
  type: ApprovalAuditEventType;
  toolId?: string;
  scope?: string;
  userId?: string;
  context?: Pick<ApprovalContext, 'type' | 'identifier'>;
  state?: 'pending' | 'expired' | 'denied' | 'approved';
  via?: 'webhook' | 'recheck';
  grantedBy?: ApprovalGrantor;
  revokedBy?: ApprovalRevoker;
  reason?: string;
  expiresAt?: number;
  count?: number;
}

/** Where audit events go. */
export interface ApprovalAuditSink {
  record(event: ApprovalAuditEvent): void;
}

/** The audit fields of a stored record. */
export function auditFieldsOf(record: ApprovalRecord): Omit<ApprovalAuditEvent, 'type'> {
  return {
    toolId: record.toolId,
    scope: record.scope,
    userId: record.userId,
    context: record.context ? { type: record.context.type, identifier: record.context.identifier } : undefined,
    grantedBy: record.grantedBy,
    reason: record.reason,
    expiresAt: record.expiresAt,
  };
}

/** Writes each event as an `info` line of the `ApprovalAudit` logger: `<type> <toolId>`, then the event's fields. */
export class LoggerAuditSink implements ApprovalAuditSink {
  constructor(private readonly logger: FrontMcpLogger) {}

  record(event: ApprovalAuditEvent): void {
    const fields = Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined));
    this.logger.info(event.toolId ? `${event.type} ${event.toolId}` : event.type, fields);
  }
}
