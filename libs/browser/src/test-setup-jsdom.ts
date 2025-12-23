// file: libs/browser/src/test-setup-jsdom.ts
/**
 * Jest test setup for jsdom environment
 *
 * This file is run before each test file when using jsdom environment.
 * It provides polyfills for browser APIs not included in jsdom.
 *
 * IMPORTANT: Polyfills MUST be set before any other imports!
 */

// Add TextEncoder/TextDecoder polyfills for jsdom BEFORE any imports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const util = require('util');
global.TextEncoder = util.TextEncoder;
global.TextDecoder = util.TextDecoder;

// Also add crypto polyfill
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCrypto = require('crypto') as typeof import('crypto');
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: nodeCrypto.subtle,
    getRandomValues: (arr: Uint8Array) => nodeCrypto.randomFillSync(arr),
  },
});

// Now import the base setup (which requires the polyfills)
require('./test-setup');
