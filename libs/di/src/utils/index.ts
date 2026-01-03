/**
 * Utility functions for dependency injection.
 */

// Metadata utilities
export { getMetadata, setMetadata, hasAsyncWith } from './metadata.utils.js';

// Token utilities
export {
  tokenName,
  isClass,
  isPromise,
  getAsyncWithTokens,
  readWithParamTypes,
  depsOfClass,
  depsOfFunc,
} from './token.utils.js';

// Provider utilities
export {
  createProviderNormalizer,
  providerDiscoveryDeps,
  providerInvocationTokens,
  type ProviderTokens,
  type ProviderNormalizerOptions,
} from './provider.utils.js';
