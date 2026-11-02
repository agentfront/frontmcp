/**
 * @file jest-preset.js
 * @description Jest preset for @frontmcp/testing
 *
 * Mirrors the config `frontmcp test` injects (libs/cli/src/commands/dev/test.ts); a CLI test fails when they differ.
 * For unit tests in a CommonJS project, use `@frontmcp/testing/jest-preset-unit`.
 *
 * Usage in jest.config.ts:
 * ```typescript
 * export default {
 *   preset: '@frontmcp/testing',
 *   // Your additional config...
 * };
 * ```
 */

const base = require('./jest-preset.base.js');

module.exports = {
  ...base,

  testTimeout: 60000,

  // Setup files that run after Jest is initialized
  // Path resolves to the compiled output when used from node_modules/@frontmcp/testing
  setupFilesAfterEnv: [require.resolve('@frontmcp/testing/setup')],

  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/src/**/*.spec.tsx',
    '<rootDir>/**/__tests__/**/*.spec.ts',
    '<rootDir>/**/__tests__/**/*.spec.tsx',
    '<rootDir>/e2e/**/*.e2e.spec.ts',
    '<rootDir>/e2e/**/*.e2e.spec.tsx',
  ],

  // Coverage settings (optional, disabled by default for E2E)
  collectCoverage: false,

  // Verbose output
  verbose: true,
};
