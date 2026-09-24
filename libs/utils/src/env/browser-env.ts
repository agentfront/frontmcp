/**
 * Browser environment stubs.
 *
 * Returns safe defaults when running in a browser context
 * where `process` is not available.
 */

import { hasEdgeGlobalScope } from './edge-scope';

export function getEnv(_key: string): string | undefined;
export function getEnv(_key: string, defaultValue: string): string;
export function getEnv(_key: string, defaultValue?: string): string | undefined {
  return defaultValue;
}

export function getCwd(): string {
  return '/';
}

export function isProduction(): boolean {
  return false;
}

export function isDevelopment(): boolean {
  return false;
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
