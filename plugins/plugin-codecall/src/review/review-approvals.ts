import type { Reference } from '@frontmcp/sdk';
import { canonicalJson, sha256Hex } from '@frontmcp/utils';

import { argumentsHashOf } from '../runs/run-journal';

/** An approval or denial in the Approval plugin's store, as CodeCall reads it. */
export interface ApprovalRecordView {
  state: string;
  scope: string;
  grantedAt: number;
  context?: { type: string; identifier: string };
  metadata?: Record<string, unknown>;
}

/** The Approval plugin's `this.approval` for the caller, as CodeCall reads it: CodeCall does not depend on the plugin. */
export interface ApprovalServiceView {
  queryApprovals(query: { toolId: string; states: string[]; includeExpired: boolean }): Promise<ApprovalRecordView[]>;
}

/** `@frontmcp/plugin-approval`'s `ApprovalServiceToken`. */
export const ApprovalServiceViewToken = Symbol.for('plugin:approval:service') as Reference<ApprovalServiceView>;

/**
 * What a person approves. `id` covers this script, this call's arguments and the review policy version; the
 * Approval plugin's record binds the caller and the expiry. `anyArgumentsId` covers any arguments of this tool in
 * this script, as many calls per run as the grant's `metadata.maxCalls` allows.
 */
export interface CodeCallApprovalReference {
  id: string;
  toolName?: string;
  argumentsHash?: string;
  anyArgumentsId?: string;
}

export type CodeCallApprovalState = 'approved' | 'denied' | 'missing';

/** A grant in the Approval plugin's store: its name, unique per grant, and when it stops counting here (epoch ms). */
export interface RecordedGrant {
  grantKey: string;
  countsUntil: number;
}

export interface ReviewApprovalsOptions {
  scriptHash: string;
  policyVersion: string;
  /** How long a grant counts after it was granted. */
  maxAgeMs: number;
  /** The Approval plugin's service for this caller, when the plugin is installed. */
  service?: ApprovalServiceView;
  /** The context the server set for this caller (`authInfo.extra.approvalContext`), for context-specific grants. */
  approvalContext?: { type: string; identifier: string };
  /** Approval ids a person approved during this request, through elicitation. */
  granted: ReadonlySet<string>;
  /** Calls to a tool a resumed run already made before it paused, which count against a grant's `maxCalls` as a call consumes it. */
  callsBefore?: (toolName: string) => number;
}

const APPROVAL_ID_PREFIX = 'codecall:approval:';
const APPROVED = 'approved';
const DENIED = 'denied';
const CONTEXT_SPECIFIC = 'context_specific';

function approvalIdOf(subject: Record<string, string>): string {
  return `${APPROVAL_ID_PREFIX}${sha256Hex(canonicalJson(subject))}`;
}

function maxCallsOf(record: ApprovalRecordView): number {
  const maxCalls = record.metadata?.['maxCalls'];
  return typeof maxCalls === 'number' && Number.isInteger(maxCalls) && maxCalls > 0 ? maxCalls : 0;
}

/** The approvals of one run: the references it asks for, and the grants it finds. */
export class ReviewApprovals {
  private readonly callsByGrant = new Map<string, number>();

  constructor(private readonly options: ReviewApprovalsOptions) {}

  /** The reference for a call, or for the whole script when a reviewer asked for approval of it. */
  referenceFor(call?: { toolName: string; args: unknown }): CodeCallApprovalReference {
    const { scriptHash, policyVersion } = this.options;
    if (!call) return { id: approvalIdOf({ scriptHash, policyVersion }) };
    const argumentsHash = argumentsHashOf(call.args);
    return {
      id: approvalIdOf({ scriptHash, policyVersion, toolName: call.toolName, argumentsHash }),
      toolName: call.toolName,
      argumentsHash,
      anyArgumentsId: approvalIdOf({ scriptHash, policyVersion, toolName: call.toolName }),
    };
  }

  /** The reference for a call over a budget: that call at its place in the run, and that budget, apart from review's. */
  budgetReferenceFor(
    call: { toolName: string; args: unknown; callIndex?: number },
    budget: string,
  ): CodeCallApprovalReference {
    const argumentsHash = argumentsHashOf(call.args);
    const subject: Record<string, string> = {
      scriptHash: this.options.scriptHash,
      budget,
      toolName: call.toolName,
      argumentsHash,
    };
    if (call.callIndex !== undefined) subject['callIndex'] = String(call.callIndex);
    return { id: approvalIdOf(subject), toolName: call.toolName, argumentsHash };
  }

  /** Whether a person approved or refused the reference; `consume` counts the call against a grant with limits. */
  async stateOf(reference: CodeCallApprovalReference, consume: boolean): Promise<CodeCallApprovalState> {
    if (this.options.granted.has(reference.id)) return APPROVED;
    const exact = await this.recordsOf(reference.id);
    if (exact.some((record) => record.state === DENIED)) return DENIED;
    if (exact.some((record) => record.state === APPROVED)) return APPROVED;
    if (!reference.anyArgumentsId) return 'missing';
    const limited = await this.recordsOf(reference.anyArgumentsId);
    if (limited.some((record) => record.state === DENIED)) return DENIED;
    const maxCalls = Math.max(0, ...limited.filter((record) => record.state === APPROVED).map(maxCallsOf));
    const callsBefore = consume ? (this.options.callsBefore?.(reference.toolName ?? '') ?? 0) : 0;
    const used = this.callsByGrant.get(reference.anyArgumentsId) ?? callsBefore;
    if (used >= maxCalls) return 'missing';
    if (consume) this.callsByGrant.set(reference.anyArgumentsId, used + 1);
    return APPROVED;
  }

  /** The Approval plugin's grants of exactly this reference that still count, or `denied` when a person refused it. */
  async recordedGrantsOf(reference: CodeCallApprovalReference): Promise<RecordedGrant[] | typeof DENIED> {
    const records = await this.recordsOf(reference.id);
    if (records.some((record) => record.state === DENIED)) return DENIED;
    return records
      .filter((record) => record.state === APPROVED)
      .map((record) => ({
        grantKey: `${reference.id}:${record.grantedAt}`,
        countsUntil: record.grantedAt + this.options.maxAgeMs,
      }));
  }

  private async recordsOf(approvalId: string): Promise<ApprovalRecordView[]> {
    const { service, maxAgeMs, approvalContext } = this.options;
    if (!service) return [];
    const records = await service.queryApprovals({
      toolId: approvalId,
      states: [APPROVED, DENIED],
      includeExpired: false,
    });
    const oldestGrant = Date.now() - maxAgeMs;
    return records.filter(
      (record) =>
        record.grantedAt >= oldestGrant &&
        (record.scope !== CONTEXT_SPECIFIC ||
          (record.context?.type === approvalContext?.type &&
            record.context?.identifier === approvalContext?.identifier)),
    );
  }
}
