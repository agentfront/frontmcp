/**
 * Dependency injection symbols for ApprovalPlugin.
 *
 * @module @frontmcp/plugin-approval
 */

import { Reference } from '@frontmcp/sdk';
import type { ApprovalStore } from './stores/approval-store.interface';
import type { ApprovalService } from './services/approval.service';
import type { ChallengeService } from './services/challenge.service';

/**
 * Token for injecting the ApprovalStore.
 */
export const ApprovalStoreToken: Reference<ApprovalStore> = Symbol.for(
  'plugin:approval:store',
) as Reference<ApprovalStore>;

/**
 * Token for injecting the ApprovalService.
 */
export const ApprovalServiceToken: Reference<ApprovalService> = Symbol.for(
  'plugin:approval:service',
) as Reference<ApprovalService>;

/**
 * Token for injecting the ChallengeService (PKCE challenge management).
 */
export const ChallengeServiceToken: Reference<ChallengeService> = Symbol.for(
  'plugin:approval:challenge-service',
) as Reference<ChallengeService>;
