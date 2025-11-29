/**
 * @frontmcp/enclave - Safe AgentScript Execution Environment
 *
 * Provides sandboxed execution for AgentScript code with:
 * - AST validation using @frontmcp/ast-guard
 * - Code transformation (whitelist-based)
 * - Runtime safety wrappers (__safe_* functions)
 * - Resource limits (timeout, memory, iterations, tool calls)
 * - VM sandbox adapter (Node.js vm module)
 *
 * @packageDocumentation
 */

// Main Enclave class
export { Enclave, runAgentScript } from './enclave';

// Types and interfaces
export type {
  ExecutionResult,
  ExecutionError,
  ExecutionStats,
  EnclaveConfig,
  CreateEnclaveOptions,
  ToolHandler,
  SafeRuntimeContext,
  ExecutionContext,
  SandboxAdapter,
  SecurityLevel,
  SecurityLevelConfig,
  SecureProxyLevelConfig,
  ReferenceSidecarOptions,
  WorkerPoolConfig,
} from './types';

// Security level configurations
export { SECURITY_LEVEL_CONFIGS } from './types';

// AI Scoring Gate
export {
  // Main orchestrator
  ScoringGate,
  ScoringGateError,
  createScoringGate,
  // Feature extraction
  FeatureExtractor,
  // Cache
  ScoringCache,
  // Scorer interface and base class
  BaseScorer,
  // Scorer implementations
  DisabledScorer,
  RuleBasedScorer,
  ExternalApiScorer,
  ExternalApiScorerError,
  // Constants
  DEFAULT_SCORING_CONFIG,
  RULE_THRESHOLDS,
} from './scoring';

export type {
  // Scorer interface
  Scorer,
  // Core types
  ScorerType,
  RiskLevel,
  SensitiveCategory,
  RuleId,
  // Feature types
  ExtractedFeatures,
  ExtractedToolCall,
  PatternSignals,
  NumericSignals,
  SensitiveAccess,
  ExtractionMeta,
  // Scoring types
  RiskSignal,
  ScoringResult,
  ScoringGateResult,
  // Configuration types
  ScoringGateConfig,
  ScoringCacheConfig,
  LocalLlmConfig,
  ExternalApiConfig,
} from './scoring';

// Safe runtime utilities
export { createSafeRuntime, serializeSafeRuntime, SafeRuntimeOptions } from './safe-runtime';

// Secure Proxy - Runtime property access protection
export {
  createSecureProxy,
  wrapGlobalsWithSecureProxy,
  createSecureStandardLibrary,
  isSecureProxy,
  createSafeReflect,
  buildBlockedPropertiesFromConfig,
  getBlockedPropertiesForLevel,
  BLOCKED_PROPERTY_CATEGORIES,
  DEFAULT_SECURE_PROXY_CONFIG,
  SecureProxyOptions,
  BlockedPropertyCategory,
} from './secure-proxy';

// Reference Sidecar (pass-by-reference support)
export {
  // Configuration
  ReferenceConfig,
  REFERENCE_CONFIGS,
  REF_ID_PREFIX,
  REF_ID_SUFFIX,
  REF_ID_PATTERN,
  isReferenceId,
  getReferenceConfig,
  // Sidecar
  ReferenceSidecar,
  ReferenceSource,
  ReferenceMetadata,
  SidecarLimitError,
  ReferenceNotFoundError,
  // Resolver
  ReferenceResolver,
  ResolutionLimitError,
  CompositeHandle,
  isCompositeHandle,
} from './sidecar';

// Worker Pool Adapter (OS-level memory isolation)
export {
  // Main adapter
  WorkerPoolAdapter,
  // Configuration
  WorkerSlotStatus,
  ResourceUsage,
  WorkerPoolMetrics,
  DEFAULT_WORKER_POOL_CONFIG,
  WORKER_POOL_PRESETS,
  buildWorkerPoolConfig,
  // Errors
  WorkerPoolError,
  WorkerTimeoutError,
  WorkerMemoryError,
  WorkerCrashedError,
  WorkerPoolDisposedError,
  QueueFullError,
  QueueTimeoutError,
  ExecutionAbortedError,
  MessageFloodError,
  MessageValidationError,
  MessageSizeError,
  WorkerStartupError,
  TooManyPendingCallsError,
  // Utility classes
  WorkerSlot,
  ExecutionQueue,
  QueueStats,
  MemoryMonitor,
  MemoryMonitorStats,
} from './adapters/worker-pool';
