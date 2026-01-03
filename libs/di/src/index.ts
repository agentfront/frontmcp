/**
 * @frontmcp/di - Generic Dependency Injection Container
 *
 * This package provides a type-safe DI container with:
 * - Token-based dependency resolution
 * - Hierarchical provider registries
 * - Scoped providers (GLOBAL, CONTEXT)
 * - Indexed registry base class for fast lookups
 * - Change event subscriptions for reactive updates
 */

// ============================================================================
// Token System
// ============================================================================

export { createTokenFactory, DiTokens, type TokenFactory, type TokenFactoryOptions } from './tokens/token.factory.js';

export { DESIGN_PARAMTYPES, META_ASYNC_WITH, META_ASYNC_WITH_TOKENS } from './tokens/di.constants.js';

// ============================================================================
// Core Types
// ============================================================================

export {
  // Base types
  type Type,
  type FuncType,
  type PartialStagesType,
  type CtorType,
  type Ctor,
  type Abstract,
  type Reference,
  type Token,
  type ClassType,
  type ValueType,
  type ClassToken,
  type FactoryType,
  type RequiredByKey,
  // Provider interfaces
  type ProviderInterface,
  type ProviderClassTokenType,
  type ProviderClassType,
  type ProviderValueType,
  type ProviderFactoryType,
  type ProviderType,
  type AsyncProvider,
  // Registry interfaces
  type DiContainerInterface,
  type DiViews,
} from './interfaces/index.js';

// ============================================================================
// Records
// ============================================================================

export {
  ProviderKind,
  type ProviderClassTokenRecord,
  type ProviderClassRecord,
  type ProviderValueRecord,
  type ProviderFactoryRecord,
  type ProviderInjectedRecord,
  type ProviderRecord,
} from './records/index.js';

// ============================================================================
// Metadata
// ============================================================================

export {
  ProviderScope,
  type ProviderMetadata,
  providerMetadataSchema,
  type RawZodShape,
  type ValidatedProviderMetadata,
} from './metadata/index.js';

// ============================================================================
// Utilities
// ============================================================================

export {
  // Metadata utilities
  getMetadata,
  setMetadata,
  hasAsyncWith,
  // Token utilities
  tokenName,
  isClass,
  isPromise,
  getAsyncWithTokens,
  readWithParamTypes,
  depsOfClass,
  depsOfFunc,
  // Provider utilities
  createProviderNormalizer,
  providerDiscoveryDeps,
  providerInvocationTokens,
  type ProviderTokens,
  type ProviderNormalizerOptions,
} from './utils/index.js';

// ============================================================================
// Registry Classes
// ============================================================================

export {
  // Base registry
  RegistryAbstract,
  type RegistryBuildMapResult,
  type RegistryKind,
  // DI container
  DiContainer,
  type ProviderEntry,
  type DiContainerOptions,
  // Indexed registry
  IndexedRegistry,
  type IndexedEntry,
  type EntryLineage,
  type EntryOwnerRef,
  type LineageSegment,
  type ChangeEvent,
  type ChangeKind,
  type ChangeScope,
  type SubscribeOptions,
  type RegistryEmitter,
  // Simple registry
  SimpleRegistry,
} from './registry/index.js';

// ============================================================================
// Decorators
// ============================================================================

export { AsyncWith } from './decorators/index.js';
