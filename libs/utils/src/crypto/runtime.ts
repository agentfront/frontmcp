/**
 * Runtime Detection
 *
 * Utilities for detecting whether code is running in Node.js or browser environment.
 */

/**
 * Check if running in Node.js environment.
 */
export function isNode(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node;
}

/**
 * Check if running in a browser-like environment with Web Crypto API.
 */
export function isBrowser(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  );
}

/**
 * Assert that code is running in Node.js.
 * @throws Error if not in Node.js environment
 */
export function assertNode(feature: string): void {
  if (!isNode()) {
    throw new Error(`${feature} is not supported in the browser. Requires Node.js.`);
  }
}
