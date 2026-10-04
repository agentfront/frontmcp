/**
 * @file jest-preset.js
 * @description Jest preset for @frontmcp/testing
 *
 * Usage in jest.config.ts:
 * ```typescript
 * export default {
 *   preset: '@frontmcp/testing',
 *   // Your additional config...
 * };
 * ```
 */

module.exports = {
  // Use Node.js environment for E2E tests
  testEnvironment: 'node',

  // Covers `.js` too: ESM-only deps ship `.js`, and un-ignoring them in `transformIgnorePatterns` needs a matching transform.
  transform: {
    '^.+\\.[tj]sx?$': [
      // The transform `frontmcp test` injects, resolved from here because @frontmcp/testing installs it
      require.resolve('@swc/jest'),
      {
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', tsx: true, decorators: true, dynamicImport: true },
          transform: { decoratorMetadata: true, legacyDecorator: true, react: { runtime: 'automatic' } },
          keepClassNames: true,
          externalHelpers: false,
          loose: true,
        },
        module: { type: 'es6' },
        sourceMaps: true,
        swcrc: false,
      },
    ],
  },

  // File extensions to consider
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

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

  // Transpile ESM-only deps (`@noble/*` for CodeCall); the `.pnpm` skip keeps this correct under pnpm (issue #519).
  transformIgnorePatterns: [
    'node_modules[/\\\\](?!\\.pnpm[/\\\\])(?!(jose|@noble[/\\\\]hashes|@noble[/\\\\]ciphers)[/\\\\])',
  ],

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Coverage settings (optional, disabled by default for E2E)
  collectCoverage: false,

  // Verbose output
  verbose: true,
};
