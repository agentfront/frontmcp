// Auth Provider Detection Module
export {
  // Schemas
  detectedAuthProviderSchema,
  authProviderDetectionResultSchema,
  // Types
  DetectedAuthProvider,
  AuthProviderDetectionResult,
  AppAuthInfo,
  // Functions
  detectAuthProviders,
  deriveProviderId,
  appRequiresOrchestration,
  getProviderScopes,
  getProviderApps,
} from './auth-provider-detection';
