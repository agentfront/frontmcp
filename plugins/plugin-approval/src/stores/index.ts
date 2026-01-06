/**
 * Store exports for ApprovalPlugin.
 *
 * @module @frontmcp/plugin-approval
 */

export type {
  ApprovalStore,
  ApprovalQuery,
  GrantApprovalOptions,
  RevokeApprovalOptions,
} from './approval-store.interface';
export {
  ApprovalStorageStore,
  type ApprovalStorageStoreOptions,
  createApprovalMemoryStore,
} from './approval-storage.store';
