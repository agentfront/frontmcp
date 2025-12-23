// file: libs/sdk/src/config/index.ts
/**
 * Runtime configuration exports for platform-agnostic SDK usage.
 */

export {
  type RuntimeConfig,
  initializeConfig,
  getConfig,
  getConfigValue,
  isConfigInitialized,
  resetConfig,
  isBrowserEnvironment,
  isNodeEnvironment,
  isWebWorkerEnvironment,
} from './runtime-config';
