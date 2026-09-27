/**
 * A tool's approval policy (`allowedScopes`, `maxTtlMs`) applied to grants and to stored records.
 *
 * @module @frontmcp/plugin-approval
 */

import { ApprovalOperationError, ApprovalScopeNotAllowedError } from './errors';
import { ApprovalScope, ApprovalState, type ApprovalRecord, type ToolApprovalRequirement } from './types';

/** The tool's `approval` metadata, normalized: `true` requires a session approval, `false`/absent requires none. */
export function resolveApprovalRequirement(
  config: ToolApprovalRequirement | boolean | undefined,
): ToolApprovalRequirement {
  if (config === true) {
    return { required: true, defaultScope: ApprovalScope.SESSION };
  }
  if (config === false || config === undefined) {
    return { required: false };
  }
  return {
    ...config,
    required: config.required ?? true,
    defaultScope: config.defaultScope ?? ApprovalScope.SESSION,
  };
}

/**
 * When a record stops counting: its own `expiresAt`, or `grantedAt + maxTtlMs` when the tool caps
 * approvals, whichever comes first. `undefined` means it never expires.
 */
export function effectiveExpiresAt(record: ApprovalRecord, requirement: ToolApprovalRequirement): number | undefined {
  const capped = requirement.maxTtlMs !== undefined ? record.grantedAt + requirement.maxTtlMs : undefined;
  if (record.expiresAt === undefined) return capped;
  return capped === undefined ? record.expiresAt : Math.min(record.expiresAt, capped);
}

/** Whether a record has expired, by its own expiry or by the tool's `maxTtlMs`. */
export function isApprovalExpired(record: ApprovalRecord, requirement: ToolApprovalRequirement, now: number): boolean {
  const expiresAt = effectiveExpiresAt(record, requirement);
  return expiresAt !== undefined && now > expiresAt;
}

/**
 * Whether a stored approval lets the tool run: approved, of a scope the tool allows, and within
 * its lifetime and the tool's `maxTtlMs`. Records written straight to the store, by an admin
 * or an external approval system, are held to the same policy as grants through `this.approval`.
 */
export function isApprovalUsable(record: ApprovalRecord, requirement: ToolApprovalRequirement, now: number): boolean {
  if (record.state !== ApprovalState.APPROVED) return false;
  if (requirement.allowedScopes?.length && !requirement.allowedScopes.includes(record.scope)) return false;
  return !isApprovalExpired(record, requirement, now);
}

/** A time-to-live must be a positive, finite number of milliseconds; anything else would never expire. */
export function assertValidTtl(ttlMs: number | undefined): void {
  if (ttlMs === undefined) return;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new ApprovalOperationError('grant', `ttlMs must be a positive number of milliseconds, got ${ttlMs}`);
  }
}

/**
 * Checks a grant against the tool's policy and returns the ttl to store: a scope the tool doesn't
 * allow throws `ApprovalScopeNotAllowedError`, a ttl above `maxTtlMs` throws, and a grant without
 * a ttl on a tool with `maxTtlMs` is given `maxTtlMs`.
 */
export function checkGrantAgainstPolicy(
  toolId: string,
  scope: ApprovalScope,
  ttlMs: number | undefined,
  requirement: ToolApprovalRequirement | undefined,
): number | undefined {
  assertValidTtl(ttlMs);
  if (!requirement) return ttlMs;

  if (requirement.allowedScopes?.length && !requirement.allowedScopes.includes(scope)) {
    throw new ApprovalScopeNotAllowedError(scope, requirement.allowedScopes);
  }

  const { maxTtlMs } = requirement;
  if (maxTtlMs === undefined) return ttlMs;
  if (ttlMs === undefined) return maxTtlMs;
  if (ttlMs > maxTtlMs) {
    throw new ApprovalOperationError(
      'grant',
      `ttlMs ${ttlMs} exceeds the maximum of ${maxTtlMs} ms that tool "${toolId}" allows`,
    );
  }
  return ttlMs;
}
