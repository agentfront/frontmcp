/**
 * Type guards for approval types.
 *
 * @module @frontmcp/utils/approval
 */

import type { ApprovalGrantor, ApprovalSourceType } from './types';

/**
 * Check if a grantor is of a specific source type.
 *
 * @param grantor - The grantor to check
 * @param source - The source type to check for
 * @returns true if the grantor matches the source type
 */
export function isGrantorSource(grantor: ApprovalGrantor, source: ApprovalSourceType): boolean {
  return grantor.source === source;
}

/**
 * Check if a grantor was granted by a human (user or admin).
 *
 * @param grantor - The grantor to check
 * @returns true if granted by a human
 */
export function isHumanGrantor(grantor: ApprovalGrantor): boolean {
  return grantor.source === 'user' || grantor.source === 'admin';
}

/**
 * Check if a grantor was auto-granted (policy, system, test).
 *
 * @param grantor - The grantor to check
 * @returns true if auto-granted
 */
export function isAutoGrantor(grantor: ApprovalGrantor): boolean {
  return grantor.source === 'policy' || grantor.source === 'system' || grantor.source === 'test';
}

/**
 * Check if a grantor was delegated (agent with delegation context).
 *
 * @param grantor - The grantor to check
 * @returns true if delegated
 */
export function isDelegatedGrantor(grantor: ApprovalGrantor): boolean {
  return grantor.source === 'agent' && !!grantor.delegationContext;
}

/**
 * Check if a grantor is from an API source (api or oauth).
 *
 * @param grantor - The grantor to check
 * @returns true if from API
 */
export function isApiGrantor(grantor: ApprovalGrantor): boolean {
  return grantor.source === 'api' || grantor.source === 'oauth';
}

/**
 * Check if a grantor has an identifier.
 *
 * @param grantor - The grantor to check
 * @returns true if has identifier
 */
export function hasGrantorIdentifier(grantor: ApprovalGrantor): grantor is ApprovalGrantor & { identifier: string } {
  return typeof grantor.identifier === 'string' && grantor.identifier.length > 0;
}

/**
 * Check if a grantor has display name.
 *
 * @param grantor - The grantor to check
 * @returns true if has display name
 */
export function hasGrantorDisplayName(grantor: ApprovalGrantor): grantor is ApprovalGrantor & { displayName: string } {
  return typeof grantor.displayName === 'string' && grantor.displayName.length > 0;
}
