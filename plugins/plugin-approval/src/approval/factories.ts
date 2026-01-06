/**
 * Factory functions for creating approval grantors and revokers.
 *
 * These helpers make it easy to create properly-typed grantor/revoker objects
 * for common scenarios.
 *
 * @example
 * ```typescript
 * import { userGrantor, testGrantor, policyGrantor } from '@frontmcp/utils';
 *
 * // In tests
 * await store.grantApproval({
 *   toolId: 'my-tool',
 *   scope: ApprovalScope.SESSION,
 *   grantedBy: testGrantor(),
 * });
 *
 * // In production
 * await store.grantApproval({
 *   toolId: 'my-tool',
 *   scope: ApprovalScope.SESSION,
 *   grantedBy: userGrantor('user-123', 'John Doe'),
 * });
 * ```
 *
 * @module @frontmcp/utils/approval
 */

import type {
  ApprovalGrantor,
  ApprovalRevoker,
  ApprovalSourceType,
  RevocationSourceType,
  DelegationContext,
  ApprovalMethod,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Grantor Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a user grantor for interactive approvals.
 *
 * @param userId - The user's unique identifier
 * @param displayName - Human-readable name for display
 * @param options - Additional options (method, origin)
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * grantedBy: userGrantor('user-123', 'John Doe')
 * // => { source: 'user', identifier: 'user-123', displayName: 'John Doe', method: 'interactive' }
 * ```
 */
export function userGrantor(
  userId: string,
  displayName?: string,
  options?: { method?: ApprovalMethod; origin?: string },
): ApprovalGrantor {
  return {
    source: 'user',
    identifier: userId,
    displayName,
    method: options?.method ?? 'interactive',
    origin: options?.origin,
  };
}

/**
 * Create a policy grantor for auto-approved tools.
 *
 * @param policyId - The policy's unique identifier
 * @param policyName - Human-readable policy name
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * grantedBy: policyGrantor('safe-list', 'Safe Tools Policy')
 * // => { source: 'policy', identifier: 'safe-list', displayName: 'Safe Tools Policy', method: 'implicit' }
 * ```
 */
export function policyGrantor(policyId: string, policyName?: string): ApprovalGrantor {
  return {
    source: 'policy',
    identifier: policyId,
    displayName: policyName,
    method: 'implicit',
  };
}

/**
 * Create an admin grantor for administrator overrides.
 *
 * @param adminId - The admin's unique identifier
 * @param displayName - Human-readable name for display
 * @param options - Additional options (method, origin)
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * grantedBy: adminGrantor('admin-456', 'Super Admin')
 * // => { source: 'admin', identifier: 'admin-456', displayName: 'Super Admin', method: 'interactive' }
 * ```
 */
export function adminGrantor(
  adminId: string,
  displayName?: string,
  options?: { method?: ApprovalMethod; origin?: string },
): ApprovalGrantor {
  return {
    source: 'admin',
    identifier: adminId,
    displayName,
    method: options?.method ?? 'interactive',
    origin: options?.origin,
  };
}

/**
 * Create a system grantor for system-level approvals.
 *
 * @param systemId - Optional system identifier (defaults to 'system')
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * grantedBy: systemGrantor()
 * // => { source: 'system', identifier: 'system', method: 'implicit' }
 * ```
 */
export function systemGrantor(systemId = 'system'): ApprovalGrantor {
  return {
    source: 'system',
    identifier: systemId,
    method: 'implicit',
  };
}

/**
 * Create an agent grantor for AI agents with delegated authority.
 *
 * @param agentId - The agent's unique identifier
 * @param delegationContext - Who authorized the agent and constraints
 * @param displayName - Human-readable agent name
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * grantedBy: agentGrantor('claude-code', {
 *   delegatorId: 'user-123',
 *   delegateId: 'claude-code',
 *   purpose: 'code editing',
 *   constraints: { paths: ['/home/user/project'] },
 * }, 'Claude Code Assistant')
 * ```
 */
export function agentGrantor(
  agentId: string,
  delegationContext: DelegationContext,
  displayName?: string,
): ApprovalGrantor {
  return {
    source: 'agent',
    identifier: agentId,
    displayName,
    method: 'delegation',
    delegationContext,
  };
}

/**
 * Create an API grantor for external API integrations.
 *
 * @param apiKeyPrefix - Prefix of the API key (for audit, not full key)
 * @param serviceName - Name of the external service
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * grantedBy: apiGrantor('sk_live_...abc', 'GitHub Actions')
 * // => { source: 'api', identifier: 'sk_live_...abc', displayName: 'GitHub Actions', method: 'api' }
 * ```
 */
export function apiGrantor(apiKeyPrefix: string, serviceName?: string): ApprovalGrantor {
  return {
    source: 'api',
    identifier: apiKeyPrefix,
    displayName: serviceName,
    method: 'api',
    origin: 'api',
  };
}

/**
 * Create an OAuth grantor for OAuth token grants.
 *
 * @param tokenId - Token identifier or subject
 * @param provider - OAuth provider name
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * grantedBy: oauthGrantor('token-xyz', 'Google')
 * // => { source: 'oauth', identifier: 'token-xyz', displayName: 'Google', method: 'api', origin: 'oauth' }
 * ```
 */
export function oauthGrantor(tokenId: string, provider?: string): ApprovalGrantor {
  return {
    source: 'oauth',
    identifier: tokenId,
    displayName: provider,
    method: 'api',
    origin: 'oauth',
  };
}

/**
 * Create a test grantor for test environments.
 * Use this in tests to avoid TypeScript errors with the old hardcoded types.
 *
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * // In tests
 * await store.grantApproval({
 *   toolId: 'tool-1',
 *   scope: ApprovalScope.SESSION,
 *   grantedBy: testGrantor(),
 * });
 * ```
 */
export function testGrantor(): ApprovalGrantor {
  return {
    source: 'test',
    identifier: 'test',
    method: 'implicit',
  };
}

/**
 * Create a custom grantor for vendor-specific sources.
 *
 * @param source - Custom source type string
 * @param identifier - Optional identifier
 * @param options - Additional options
 * @returns ApprovalGrantor object
 *
 * @example
 * ```typescript
 * // Vendor-specific RBAC
 * grantedBy: customGrantor('frontcloud-rbac', 'role:admin', {
 *   displayName: 'Admin Role',
 *   method: 'implicit',
 *   origin: 'frontcloud-iam',
 * })
 * ```
 */
export function customGrantor(
  source: string,
  identifier?: string,
  options?: {
    displayName?: string;
    method?: ApprovalMethod;
    origin?: string;
    delegationContext?: DelegationContext;
  },
): ApprovalGrantor {
  return {
    source,
    identifier,
    displayName: options?.displayName,
    method: options?.method,
    origin: options?.origin,
    delegationContext: options?.delegationContext,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revoker Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a user revoker for interactive revocations.
 *
 * @param userId - The user's unique identifier
 * @param displayName - Human-readable name for display
 * @returns ApprovalRevoker object
 */
export function userRevoker(userId: string, displayName?: string): ApprovalRevoker {
  return {
    source: 'user',
    identifier: userId,
    displayName,
    method: 'interactive',
  };
}

/**
 * Create an admin revoker for administrator revocations.
 *
 * @param adminId - The admin's unique identifier
 * @param displayName - Human-readable name for display
 * @returns ApprovalRevoker object
 */
export function adminRevoker(adminId: string, displayName?: string): ApprovalRevoker {
  return {
    source: 'admin',
    identifier: adminId,
    displayName,
    method: 'interactive',
  };
}

/**
 * Create an expiry revoker for TTL-based revocations.
 *
 * @returns ApprovalRevoker object
 */
export function expiryRevoker(): ApprovalRevoker {
  return {
    source: 'expiry',
    method: 'expiry',
  };
}

/**
 * Create a session end revoker for session cleanup.
 *
 * @param sessionId - The session that ended
 * @returns ApprovalRevoker object
 */
export function sessionEndRevoker(sessionId?: string): ApprovalRevoker {
  return {
    source: 'session_end',
    identifier: sessionId,
    method: 'implicit',
  };
}

/**
 * Create a policy revoker for policy-based revocations.
 *
 * @param policyId - The policy's unique identifier
 * @param policyName - Human-readable policy name
 * @returns ApprovalRevoker object
 */
export function policyRevoker(policyId: string, policyName?: string): ApprovalRevoker {
  return {
    source: 'policy',
    identifier: policyId,
    displayName: policyName,
    method: 'policy',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a grantedBy input to the structured ApprovalGrantor format.
 * Accepts either a simple string source type or a full ApprovalGrantor object.
 *
 * @param input - String source type or ApprovalGrantor object
 * @returns Normalized ApprovalGrantor object
 *
 * @example
 * ```typescript
 * normalizeGrantor('user')
 * // => { source: 'user' }
 *
 * normalizeGrantor({ source: 'user', identifier: 'user-123' })
 * // => { source: 'user', identifier: 'user-123' }
 * ```
 */
export function normalizeGrantor(input: ApprovalGrantor | ApprovalSourceType | undefined): ApprovalGrantor {
  if (!input) {
    return { source: 'user' };
  }
  if (typeof input === 'string') {
    return { source: input };
  }
  return input;
}

/**
 * Normalize a revokedBy input to the structured ApprovalRevoker format.
 * Accepts either a simple string source type or a full ApprovalRevoker object.
 *
 * @param input - String source type or ApprovalRevoker object
 * @returns Normalized ApprovalRevoker object
 *
 * @example
 * ```typescript
 * normalizeRevoker('expiry')
 * // => { source: 'expiry' }
 *
 * normalizeRevoker({ source: 'admin', identifier: 'admin-456' })
 * // => { source: 'admin', identifier: 'admin-456' }
 * ```
 */
export function normalizeRevoker(input: ApprovalRevoker | RevocationSourceType | undefined): ApprovalRevoker {
  if (!input) {
    return { source: 'user' };
  }
  if (typeof input === 'string') {
    return { source: input };
  }
  return input;
}
