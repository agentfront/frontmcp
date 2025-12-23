// file: libs/sdk/src/config/runtime-config.ts
/**
 * Runtime configuration system for platform-agnostic SDK usage.
 *
 * In Node.js environments, configuration falls back to process.env for backward compatibility.
 * In browser environments, initializeConfig() must be called before using SDK patterns.
 */

import { generateUUID } from '../utils/platform-crypto';

/**
 * Runtime configuration interface
 */
export interface RuntimeConfig {
  /** Debug mode enabled */
  debug: boolean;

  /** Development environment (affects error verbosity) */
  isDevelopment: boolean;

  /** Machine identifier for distributed deployments */
  machineId: string;

  /** Session encryption secret (optional, for auth) */
  sessionSecret?: string;

  /** JWT secret (optional, for auth) */
  jwtSecret?: string;
}

/**
 * Global configuration instance
 */
let globalConfig: RuntimeConfig | null = null;

/**
 * Initialize runtime configuration.
 * Call once at application startup.
 *
 * @example Browser initialization
 * ```typescript
 * import { initializeConfig, generateUUID } from '@frontmcp/sdk/core';
 *
 * initializeConfig({
 *   debug: location.hostname === 'localhost',
 *   isDevelopment: location.hostname === 'localhost',
 *   machineId: generateUUID(),
 * });
 * ```
 *
 * @example Node.js initialization (optional - will use process.env as fallback)
 * ```typescript
 * import { initializeConfig } from '@frontmcp/sdk';
 *
 * initializeConfig({
 *   debug: process.env['DEBUG'] === 'true',
 *   isDevelopment: process.env['NODE_ENV'] === 'development',
 *   machineId: process.env['MACHINE_ID'] || generateUUID(),
 * });
 * ```
 */
export function initializeConfig(config: Partial<RuntimeConfig>): void {
  globalConfig = {
    debug: config.debug ?? false,
    isDevelopment: config.isDevelopment ?? false,
    machineId: config.machineId ?? generateUUID(),
    sessionSecret: config.sessionSecret,
    jwtSecret: config.jwtSecret,
  };
}

/**
 * Check if runtime configuration has been initialized
 */
export function isConfigInitialized(): boolean {
  return globalConfig !== null;
}

/**
 * Reset configuration (primarily for testing)
 */
export function resetConfig(): void {
  globalConfig = null;
}

/**
 * Get runtime configuration.
 * Falls back to process.env in Node.js if not initialized.
 *
 * @throws Error in browser if initializeConfig() was not called
 *
 * @example
 * ```typescript
 * import { getConfig } from '@frontmcp/sdk/core';
 *
 * const config = getConfig();
 * if (config.debug) {
 *   console.log('Debug mode enabled');
 * }
 * ```
 */
export function getConfig(): RuntimeConfig {
  if (globalConfig) {
    return globalConfig;
  }

  // Fallback for Node.js (backward compatibility)
  if (typeof process !== 'undefined' && process.env) {
    return {
      debug: process.env['DEBUG'] === 'true',
      isDevelopment: process.env['NODE_ENV'] !== 'production',
      machineId: process.env['MACHINE_ID'] ?? generateUUID(),
      sessionSecret: process.env['MCP_SESSION_SECRET'],
      jwtSecret: process.env['JWT_SECRET'],
    };
  }

  throw new Error('Runtime config not initialized. Call initializeConfig() first.');
}

/**
 * Get a specific config value with optional default.
 * Useful for accessing single config properties without getting the full config.
 *
 * @example
 * ```typescript
 * const debug = getConfigValue('debug', false);
 * const machineId = getConfigValue('machineId');
 * ```
 */
export function getConfigValue<K extends keyof RuntimeConfig>(
  key: K,
  defaultValue?: RuntimeConfig[K],
): RuntimeConfig[K] {
  try {
    const config = getConfig();
    return config[key] ?? defaultValue!;
  } catch {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Config value '${key}' not available and no default provided.`);
  }
}

/**
 * Check if we're running in a browser environment
 */
export function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Check if we're running in Node.js environment
 */
export function isNodeEnvironment(): boolean {
  return typeof process !== 'undefined' && process.versions?.node !== undefined;
}

/**
 * Check if we're running in a WebWorker environment
 */
export function isWebWorkerEnvironment(): boolean {
  return typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function';
}
