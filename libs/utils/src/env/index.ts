export {
  getEnv,
  getCwd,
  isProduction,
  isDevelopment,
  getEnvFlag,
  isDebug,
  setEnv,
  isEdgeRuntime,
  isServerless,
  supportsAnsi,
} from '#env';

// Runtime context detection and entry availability matching
export {
  getRuntimeContext,
  resetRuntimeContext,
  detectRuntimeContext,
  isEntryAvailable,
  checkEntryAvailability,
  entryAvailabilitySchema,
} from '#runtime-context';
export type { RuntimeContext, EntryAvailability, Surface, CallContext } from '#runtime-context';

// Issue #417 — deploy-provider + build-target detection
export { detectProvider, resetProviderCacheForTesting } from './provider';
export type { DeployProvider } from './provider';
export { getBuildTarget, resetBuildTargetCacheForTesting } from './build-target';
export type { BuildTarget } from './build-target';
