// Auth Provider Detection Module
export {
  detectedAuthProviderSchema,
  authProviderDetectionResultSchema,
  detectAuthProviders,
  deriveProviderId,
  appRequiresOrchestration,
  getProviderScopes,
  getProviderApps,
} from './auth-provider-detection';
export type { DetectedAuthProvider, AuthProviderDetectionResult, AppAuthInfo } from './auth-provider-detection';
