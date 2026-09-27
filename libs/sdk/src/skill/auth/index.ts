// file: libs/sdk/src/skill/auth/index.ts

/**
 * Skill HTTP Authentication
 *
 * Provides authentication validation for skills HTTP endpoints.
 *
 * @module skill/auth
 */

export { SkillHttpAuthValidator, authorizeSkillHttpRequest, createSkillHttpAuthValidator } from './skill-http-auth';
export type {
  SkillHttpAccess,
  SkillHttpAuthContext,
  SkillHttpAuthResult,
  SkillHttpAuthValidatorOptions,
} from './skill-http-auth';
