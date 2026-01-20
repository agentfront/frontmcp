/**
 * Elicitation Store Module
 *
 * Storage abstractions for elicitation state management.
 * Uses @frontmcp/utils storage for unified backend support.
 *
 * @module elicitation/store
 */

// Store interface
export type {
  ElicitationStore,
  PendingElicitRecord,
  ElicitResultCallback,
  ElicitUnsubscribe,
} from './elicitation.store';

// Store implementation
export { StorageElicitationStore } from './storage-elicitation.store';

// Factory functions
export {
  createElicitationStore,
  createMemoryElicitationStore,
  createElicitationStoreFromStorage,
  type ElicitationStoreOptions,
  type ElicitationStoreResult,
} from './elicitation-store.factory';
