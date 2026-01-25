// common/types/options/skills-http/index.ts
// Barrel export for skills HTTP options

export type {
  SkillsConfigOptions,
  SkillsConfigEndpointConfig,
  SkillsConfigAuthMode,
  SkillsConfigJwtOptions,
  SkillsConfigCacheOptions,
} from './interfaces';
export {
  skillsConfigOptionsSchema,
  skillsConfigEndpointConfigSchema,
  skillsConfigAuthModeSchema,
  normalizeEndpointConfig,
  normalizeSkillsConfigOptions,
} from './schema';
export type { SkillsConfigOptionsInput, SkillsConfigEndpointConfigInput, NormalizedEndpointConfig } from './schema';
