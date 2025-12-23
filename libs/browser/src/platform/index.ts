// file: libs/browser/src/platform/index.ts
/**
 * Browser platform adapters.
 *
 * This module provides browser-specific implementations of the SDK's
 * platform abstraction interfaces. These adapters allow the SDK's
 * core functionality to work in browser environments.
 *
 * @example
 * ```typescript
 * import {
 *   BrowserCryptoAdapter,
 *   BrowserStorageAdapter,
 *   BrowserContextStorage,
 * } from '@frontmcp/browser';
 *
 * // Create platform configuration for browser
 * const platform = {
 *   crypto: new BrowserCryptoAdapter(),
 *   storage: new BrowserStorageAdapter(),
 *   isBrowser: true,
 *   isDevelopment: location.hostname === 'localhost',
 * };
 * ```
 */

// Crypto adapter
export { BrowserCryptoAdapter, browserCrypto } from './crypto.adapter';

// Storage adapter
export { BrowserStorageAdapter, browserStorage, type StorageType, type BrowserStorageOptions } from './storage.adapter';

// Context adapter
export { BrowserContextStorage, AsyncBrowserContextStorage, createBrowserContextStorage } from './context.adapter';

// Re-export platform types from SDK
export type {
  PlatformCrypto,
  PlatformStorage,
  PlatformContextStorage,
  PlatformConfig,
  PlatformLogger,
} from '@frontmcp/sdk/core';
