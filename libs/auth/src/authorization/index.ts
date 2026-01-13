/**
 * Authorization Module
 *
 * Core types for authorization, user identity, and progressive auth.
 */

// Types
export type {
  AuthMode,
  AuthUser,
  AuthorizedTool,
  AuthorizedPrompt,
  LLMSafeAuthContext,
  AppAuthorizationRecord,
  ProgressiveAuthState,
  AuthorizationCreateCtx,
} from './authorization.types';

// Enums
export { AppAuthState } from './authorization.types';

// Schemas
export {
  authModeSchema,
  authUserSchema,
  authorizedToolSchema,
  authorizedPromptSchema,
  llmSafeAuthContextSchema,
  appAuthStateSchema,
  appAuthorizationRecordSchema,
  progressiveAuthStateSchema,
} from './authorization.types';
