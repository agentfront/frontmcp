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
export declare function isGrantorSource(grantor: ApprovalGrantor, source: ApprovalSourceType): boolean;
/**
 * Check if a grantor was granted by a human (user or admin).
 *
 * @param grantor - The grantor to check
 * @returns true if granted by a human
 */
export declare function isHumanGrantor(grantor: ApprovalGrantor): boolean;
/**
 * Check if a grantor was auto-granted (policy, system, test).
 *
 * @param grantor - The grantor to check
 * @returns true if auto-granted
 */
export declare function isAutoGrantor(grantor: ApprovalGrantor): boolean;
/**
 * Check if a grantor was delegated (agent with delegation context).
 *
 * @param grantor - The grantor to check
 * @returns true if delegated
 */
export declare function isDelegatedGrantor(grantor: ApprovalGrantor): boolean;
/**
 * Check if a grantor is from an API source (api or oauth).
 *
 * @param grantor - The grantor to check
 * @returns true if from API
 */
export declare function isApiGrantor(grantor: ApprovalGrantor): boolean;
/**
 * Check if a grantor has an identifier.
 *
 * @param grantor - The grantor to check
 * @returns true if has identifier
 */
export declare function hasGrantorIdentifier(grantor: ApprovalGrantor): grantor is ApprovalGrantor & {
  identifier: string;
};
/**
 * Check if a grantor has display name.
 *
 * @param grantor - The grantor to check
 * @returns true if has display name
 */
export declare function hasGrantorDisplayName(grantor: ApprovalGrantor): grantor is ApprovalGrantor & {
  displayName: string;
};
