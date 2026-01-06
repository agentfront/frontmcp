/**
 * Service exports for ApprovalPlugin.
 *
 * @module @frontmcp/plugin-approval
 */

export { ApprovalService, createApprovalService, type GrantOptions, type RevokeOptions } from './approval.service';
export {
  ChallengeService,
  createMemoryChallengeService,
  type ChallengeServiceOptions,
  type CreateChallengeOptions,
} from './challenge.service';
