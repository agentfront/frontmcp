// file: libs/sdk/src/utils/platform-crypto.ts
/**
 * Platform-agnostic crypto utilities
 * Works in both Node.js 19+ and browser environments using Web Crypto API
 */

/**
 * Generate a UUID v4
 * Uses native crypto.randomUUID() available in both Node.js 19+ and modern browsers
 */
export function generateUUID(): string {
  // crypto.randomUUID() is available in:
  // - Node.js 19+
  // - All modern browsers
  // - Web Workers
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for older environments (not cryptographically secure)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate random bytes
 * Uses Web Crypto API available in both Node.js and browsers
 */
export function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return bytes;
  }

  // Fallback (not cryptographically secure - only for non-security use)
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Generate random bytes as hex string
 */
export function getRandomHex(length: number): string {
  const bytes = getRandomBytes(length);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create SHA-256 hash (async - required for Web Crypto)
 * Works in both Node.js and browsers
 */
export async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  throw new Error('Web Crypto API not available');
}

/**
 * Create SHA-256 hash synchronously (Node.js only)
 * @throws in browser environment - use sha256() async version instead
 */
export function sha256Sync(data: string): string {
  // Check if we're in Node.js by looking for node-specific global
  if (typeof process !== 'undefined' && process.versions?.node) {
    // Dynamic require to avoid bundling issues in browser builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require('crypto');
    return createHash('sha256').update(data).digest('hex');
  }

  throw new Error('sha256Sync is only available in Node.js. Use sha256() in browser.');
}

/**
 * Simple non-cryptographic hash for transport keys (not security-sensitive)
 * Works synchronously in both Node.js and browsers
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}
