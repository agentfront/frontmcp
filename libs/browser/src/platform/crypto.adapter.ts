// file: libs/browser/src/platform/crypto.adapter.ts
/**
 * Browser implementation of PlatformCrypto using Web Crypto API.
 */

import type { PlatformCrypto } from '@frontmcp/sdk/core';

/**
 * Browser crypto adapter using Web Crypto API.
 *
 * This adapter provides cryptographic functionality for browser environments
 * using the standard Web Crypto API available in all modern browsers.
 *
 * @example
 * ```typescript
 * import { BrowserCryptoAdapter } from '@frontmcp/browser';
 *
 * const crypto = new BrowserCryptoAdapter();
 * const uuid = crypto.randomUUID();
 * const hash = await crypto.sha256('hello');
 * ```
 */
export class BrowserCryptoAdapter implements PlatformCrypto {
  /**
   * Generate a random UUID (v4) using the Web Crypto API.
   */
  randomUUID(): string {
    // Use native crypto.randomUUID() if available (modern browsers)
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    // Fallback for older browsers
    return this.generateUUIDFallback();
  }

  /**
   * Fill a Uint8Array with cryptographically secure random values.
   */
  getRandomValues(array: Uint8Array): Uint8Array {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
      throw new Error('Web Crypto API not available');
    }
    return crypto.getRandomValues(array);
  }

  /**
   * Generate random bytes as a hex string.
   */
  getRandomHex(length: number): string {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    this.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, length);
  }

  /**
   * Compute SHA-256 hash of input data.
   * Returns hex-encoded hash string.
   */
  async sha256(data: string | Uint8Array): Promise<string> {
    if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
      throw new Error('Web Crypto API not available');
    }

    const encoder = new TextEncoder();
    const dataBytes = typeof data === 'string' ? encoder.encode(data) : data;

    // Create a proper ArrayBuffer from the Uint8Array for Web Crypto API
    // Use explicit type cast to satisfy TypeScript's strict checking
    const buffer = dataBytes.buffer.slice(
      dataBytes.byteOffset,
      dataBytes.byteOffset + dataBytes.byteLength,
    ) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = new Uint8Array(hashBuffer);

    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Fallback UUID generation for browsers without crypto.randomUUID().
   */
  private generateUUIDFallback(): string {
    const bytes = new Uint8Array(16);
    this.getRandomValues(bytes);

    // Set version 4 (random)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant (RFC 4122)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
  }
}

/**
 * Singleton instance of browser crypto adapter.
 */
export const browserCrypto = new BrowserCryptoAdapter();
