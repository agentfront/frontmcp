// file: libs/sdk/src/skill/providers/index.ts

/**
 * Skill Storage Providers
 *
 * Implementations of SkillStorageProvider for different backends.
 *
 * @module skill/providers
 */

// Memory provider (default)
export { MemorySkillProvider } from './memory-skill.provider';
export type { MemorySkillProviderOptions } from './memory-skill.provider';

// External provider base class
export { ExternalSkillProviderBase } from './external-skill.provider';
export type {
  ExternalSkillMode,
  ExternalSkillProviderOptions,
  ExternalSkillSearchOptions,
  ExternalSkillListOptions,
} from './external-skill.provider';
