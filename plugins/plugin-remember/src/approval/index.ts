// Types
export * from './approval.types';

// Interfaces
export type {
  ApprovalStore,
  ApprovalQuery,
  GrantApprovalOptions,
  RevokeApprovalOptions,
} from './approval-store.interface';

// Errors
export { ApprovalRequiredError, ApprovalOperationError, ApprovalScopeNotAllowedError } from './approval.errors';

// Service
export { ApprovalService, createApprovalService } from './approval.service';

// Store implementations
export { ApprovalMemoryStore } from './approval-memory.store';
export { ApprovalStorageStore, ApprovalStorageStoreOptions, createApprovalMemoryStore } from './approval-storage.store';

// Hook plugin
export { default as ApprovalCheckPlugin } from './approval-check.hook';
