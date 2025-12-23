// file: libs/browser/src/test-setup.ts
/**
 * Jest test setup for @frontmcp/browser
 *
 * This file is run before each test file. It sets up the test environment
 * with necessary configuration.
 */

// Initialize runtime config for tests
import { initializeConfig, resetConfig, generateUUID } from '@frontmcp/sdk/core';

// Reset and initialize config before each test
beforeEach(() => {
  resetConfig();
  initializeConfig({
    debug: true,
    isDevelopment: true,
    machineId: generateUUID(),
  });
});

// Clean up after each test
afterEach(() => {
  resetConfig();
});
