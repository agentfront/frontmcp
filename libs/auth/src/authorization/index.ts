/**
 * Authorization Module
 *
 * Core types, base class, and mode-specific implementations for authorization.
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
  Authorization,
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

// Base class
export { AuthorizationBase, getMachineId } from './authorization.class';

// Mode-specific implementations
export { PublicAuthorization } from './public.authorization';
export type { PublicAuthorizationCreateCtx } from './public.authorization';

export { TransparentAuthorization } from './transparent.authorization';
export type { TransparentAuthorizationCreateCtx, TransparentVerifiedPayload } from './transparent.authorization';

export { OrchestratedAuthorization } from './orchestrated.authorization';
export type {
  OrchestratedAuthorizationCreateCtx,
  OrchestratedProviderState,
  TokenStore as OrchestratedTokenStore,
  TokenRefreshCallback,
} from './orchestrated.authorization';

// Orchestrated auth accessor for tool context
export type { OrchestratedAuthAccessor } from './orchestrated.accessor';
export {
  OrchestratedAuthAccessorAdapter,
  NullOrchestratedAuthAccessor,
  ORCHESTRATED_AUTH_ACCESSOR,
} from './orchestrated.accessor';
