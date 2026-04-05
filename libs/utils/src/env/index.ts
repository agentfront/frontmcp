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
  entryAvailabilitySchema,
} from '#runtime-context';
export type { RuntimeContext, EntryAvailability } from '#runtime-context';
