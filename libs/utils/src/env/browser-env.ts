/**
 * Browser environment stubs.
 *
 * Returns safe defaults when running in a browser context
 * where `process` is not available.
 */

import { hasEdgeGlobalScope } from './edge-scope';

/** A computed key: bundlers only replace the literal `process.env.NODE_ENV` member expression. */
const NODE_ENV_KEY = 'NODE_ENV';

type ProcessShim = { env?: Record<string, string | undefined> };

function bundlerDefinedNodeEnv(): string | undefined {
  try {
    return process.env['NODE_ENV'] || undefined;
  } catch {
    return undefined;
  }
}

export function getEnv(_key: string): string | undefined;
export function getEnv(_key: string, defaultValue: string): string;
export function getEnv(_key: string, defaultValue?: string): string | undefined {
  return defaultValue;
}

export function getCwd(): string {
  return '/';
}

/**
 * The NODE_ENV the page runs with: a `process` shim's live value first, then the value a
 * bundler inlined for `process.env.NODE_ENV`, else none. `isProduction()`, `isDevelopment()`
 * and the runtime context's `env` all read it (#770). As on Node, with no NODE_ENV the
 * runtime context reports `development` while `isDevelopment()` stays false.
 */
export function getNodeEnv(): string | undefined {
  const shim = (globalThis as { process?: ProcessShim }).process;
  return shim?.env?.[NODE_ENV_KEY] || bundlerDefinedNodeEnv();
}

export function isProduction(): boolean {
  return getNodeEnv() === 'production';
}

export function isDevelopment(): boolean {
  return getNodeEnv() === 'development';
}

export function getEnvFlag(_key: string): boolean {
  return false;
}

export function isDebug(): boolean {
  return false;
}

export function setEnv(_key: string, _value: string): void {}

export function isEdgeRuntime(): boolean {
  return hasEdgeGlobalScope();
}

export function isServerless(): boolean {
  return false;
}

export function supportsAnsi(): boolean {
  return false;
}
