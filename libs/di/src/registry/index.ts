/**
 * Registry classes for dependency injection.
 */

// Base registry
export { RegistryAbstract, type RegistryBuildMapResult, type RegistryKind } from './registry.base.js';

// DI container
export { DiContainer, type ProviderEntry, type DiContainerOptions } from './container.js';

// Indexed registry
export { IndexedRegistry } from './indexed.registry.js';
export {
  type IndexedEntry,
  type EntryLineage,
  type EntryOwnerRef,
  type LineageSegment,
  type ChangeEvent,
  type ChangeKind,
  type ChangeScope,
  type SubscribeOptions,
  type RegistryEmitter,
} from './indexed.types.js';

// Simple registry
export { SimpleRegistry } from './simple.registry.js';
