// file: libs/sdk/src/skill/index.ts

/**
 * Skills Module
 *
 * Skills are modular knowledge/workflow packages that teach AI how to perform
 * multi-step tasks using tools. Unlike tools (individual actions), skills are
 * recipes/playbooks that combine tools into coherent workflows.
 *
 * @example Defining a skill with decorator
 * ```typescript
 * @Skill({
 *   name: 'review-pr',
 *   description: 'Review a GitHub pull request',
 *   instructions: `
 *     1. Fetch the PR details using github_get_pr
 *     2. Review each changed file...
 *   `,
 *   tools: ['github_get_pr', 'github_add_comment'],
 * })
 * class ReviewPRSkill extends SkillContext { ... }
 * ```
 *
 * @example Defining a skill with helper
 * ```typescript
 * const deploySkill = skill({
 *   name: 'deploy-app',
 *   description: 'Deploy application to production',
 *   instructions: { file: './skills/deploy.md' },
 *   tools: ['docker_build', 'k8s_apply'],
 * });
 * ```
 *
 * @module skill
 */

// Registry
export { default as SkillRegistry } from './skill.registry';
export type { SkillRegistryInterface, IndexedSkill, SkillRegistryOptions, GetSkillsOptions } from './skill.registry';

// Instance
export { SkillInstance, createSkillInstance } from './skill.instance';

// Events
export { SkillEmitter } from './skill.events';
export type { SkillChangeEvent, SkillChangeKind, SkillChangeScope } from './skill.events';

// Storage
export type {
  SkillStorageProvider,
  SkillStorageProviderType,
  SkillSearchOptions,
  SkillSearchResult,
  SkillLoadResult,
  SkillListOptions,
  SkillListResult,
  MutableSkillStorageProvider,
} from './skill-storage.interface';

// Providers
export { MemorySkillProvider } from './providers/memory-skill.provider';
export type { MemorySkillProviderOptions } from './providers/memory-skill.provider';
export { ExternalSkillProviderBase } from './providers/external-skill.provider';
export type {
  ExternalSkillMode,
  ExternalSkillProviderOptions,
  ExternalSkillSearchOptions,
  ExternalSkillListOptions,
} from './providers/external-skill.provider';

// Validator
export { SkillToolValidator } from './skill-validator';
export type { ToolValidationResult } from './skill-validator';

// Factory
export { createSkillStorageProvider, createMemorySkillProvider } from './skill-storage.factory';
export type {
  SkillStorageFactoryOptions,
  SkillStorageFactoryResult,
  VectorDBSkillProviderOptions,
  ExternalSkillProviderConfig,
  ExtendedSkillStorageFactoryResult,
} from './skill-storage.factory';

// Sync
export {
  computeSkillHash,
  computeSkillHashComponents,
  areSkillsEqual,
  createEmptySyncState,
  serializeSyncState,
  deserializeSyncState,
  MemorySyncStateStore,
} from './sync';
export type {
  SkillHashComponents,
  SkillSyncStatus,
  SkillSyncEntry,
  SkillSyncState,
  SerializedSkillSyncState,
  SkillSyncStateStore,
  SyncResult,
} from './sync';

// Utilities
export {
  normalizeSkill,
  isSkillRecord,
  skillDiscoveryDeps,
  collectSkillMetadata,
  loadInstructions,
  buildSkillContent,
  formatSkillForLLM,
} from './skill.utils';

// HTTP Utilities
export {
  formatSkillsForLlmCompact,
  formatSkillsForLlmFull,
  formatSkillForLLMWithSchemas,
  skillToApiResponse,
  filterSkillsByVisibility,
} from './skill-http.utils';
export type { CompactSkillSummary } from './skill-http.utils';

// Flows
export { SearchSkillsFlow, LoadSkillFlow } from './flows';

// Tools (deprecated - use flows instead)
export { SearchSkillsTool, LoadSkillsTool, LoadSkillTool, getSkillTools } from './tools';

// Session Management
export { SkillSessionManager } from './session/skill-session.manager';
export { MemorySkillSessionStore, createSkillSessionStore } from './session/skill-session-store.interface';
export type { SkillSessionStore } from './session/skill-session-store.interface';
export { serializeSessionState, deserializeSessionState, createEmptySessionState } from './session/skill-session.types';
export type {
  SkillSessionState,
  SkillSessionOptions,
  SkillActivationResult,
  ToolAuthorizationResult,
  SkillSessionEvent,
  SkillSecurityPolicy,
  SkillPolicyMode,
  SerializedSkillSessionState,
} from './session/skill-session.types';

// Guards
export { ToolAuthorizationGuard } from './guards/tool-authorization.guard';
export type { ToolAuthorizationGuardOptions } from './guards/tool-authorization.guard';

// Hooks
export { createSkillToolGuardHook, type SkillToolGuardHookOptions, type SkillToolGuardHookClass } from './hooks';

// Errors
export { ToolNotAllowedError, ToolApprovalRequiredError } from './errors/tool-not-allowed.error';
export { SkillValidationError } from './errors/skill-validation.error';
export type { SkillValidationResult, SkillValidationReport } from './errors/skill-validation.error';

// Scope Helper
export { registerSkillCapabilities } from './skill-scope.helper';
export type { SkillScopeRegistrationOptions } from './skill-scope.helper';

// Mode Utilities
export { detectSkillsOnlyMode, isSkillsOnlySession } from './skill-mode.utils';
export type { SkillsOnlySessionPayload } from './skill-mode.utils';

// HTTP Authentication
export { SkillHttpAuthValidator, createSkillHttpAuthValidator } from './auth';
export type { SkillHttpAuthContext, SkillHttpAuthResult, SkillHttpAuthValidatorOptions } from './auth';

// HTTP Caching
export {
  SkillHttpCache,
  MemorySkillHttpCache,
  RedisSkillHttpCache,
  createSkillHttpCache,
  getSkillHttpCache,
  invalidateScopeCache,
  invalidateSkillInCache,
  disposeAllCaches,
} from './cache';
export type { SkillHttpCacheOptions, SkillHttpCacheResult } from './cache';
