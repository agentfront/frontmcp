// auth/authorization/index.ts

// Types
export * from './authorization.types';

// Base class
export { AuthorizationBase, getMachineId } from './authorization.class';

// Mode-specific implementations
export { PublicAuthorization, PublicAuthorizationCreateCtx } from './public.authorization';
export {
  TransparentAuthorization,
  TransparentAuthorizationCreateCtx,
  TransparentVerifiedPayload,
} from './transparent.authorization';
export {
  OrchestratedAuthorization,
  OrchestratedAuthorizationCreateCtx,
  OrchestratedProviderState,
  TokenStore,
  TokenRefreshCallback,
} from './orchestrated.authorization';

// Orchestrated auth accessor for tool context
export {
  OrchestratedAuthAccessor,
  OrchestratedAuthAccessorAdapter,
  NullOrchestratedAuthAccessor,
  ORCHESTRATED_AUTH_ACCESSOR,
} from './orchestrated.accessor';

// Context extension for this.orchestration
export { orchestratedAuthContextExtension, getOrchestration, hasOrchestration } from './orchestrated.context-extension';
