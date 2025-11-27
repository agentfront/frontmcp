/**
 * @file jest-preset.js
 * @description Jest preset for @frontmcp/testing
 *
 * Usage in jest.config.ts or jest.e2e.config.ts:
 * ```typescript
 * export default {
 *   preset: '@frontmcp/testing/jest-preset',
 *   // Your additional config...
 * };
 * ```
 */

module.exports = {
  // Use Node.js environment for E2E tests
  testEnvironment: 'node',

  // Transform TypeScript files
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: {
          // Allow importing .js extensions for ESM compatibility
          moduleResolution: 'node',
        },
      },
    ],
  },

  // File extensions to consider
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Default test timeout (30 seconds for E2E)
  testTimeout: 30000,

  // Setup files that run after Jest is initialized
  // Path resolves to the compiled output when used from node_modules/@frontmcp/testing
  setupFilesAfterEnv: [require.resolve('@frontmcp/testing/setup')],

  // Test file patterns for E2E tests
  testMatch: ['**/*.e2e.ts', '**/*.e2e.js', '**/e2e/**/*.test.ts', '**/e2e/**/*.test.js'],

  // Module name mapping for path aliases
  moduleNameMapper: {
    // Map @frontmcp/testing to the installed package
    '^@frontmcp/testing$': '<rootDir>/node_modules/@frontmcp/testing/src/index.js',
    '^@frontmcp/testing/(.*)$': '<rootDir>/node_modules/@frontmcp/testing/$1',
  },

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Coverage settings (optional, disabled by default for E2E)
  collectCoverage: false,

  // Verbose output
  verbose: true,
};
