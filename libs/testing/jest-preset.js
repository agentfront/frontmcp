/**
 * @file jest-preset.js
 * @description Jest preset for @frontmcp/testing
 *
 * Usage in jest.config.ts or jest.e2e.config.ts:
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

  // Must cover `.js`/`.jsx` as well as `.ts`/`.tsx`: `transformIgnorePatterns`
  // only un-ignores a file and `testMatch` only discovers one — the transform
  // still has to match it. ESM-only deps ship `.js`, and testMatch accepts
  // `.e2e.spec.js(x)`, so a `.tsx?`-only rule would silently skip both.
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

  // Default test timeout (30 seconds for E2E)
  testTimeout: 30000,

  // Setup files that run after Jest is initialized
  // Path resolves to the compiled output when used from node_modules/@frontmcp/testing
  setupFilesAfterEnv: [require.resolve('@frontmcp/testing/setup')],

  // E2E specs, per the `.e2e.spec.ts(x)` convention the CLI's injected config
  // also enforces. The legacy `.e2e.ts` / `.test.ts` globs matched none of the
  // documented names, so projects on this preset silently ran zero E2E tests.
  testMatch: ['**/*.e2e.spec.ts', '**/*.e2e.spec.tsx', '**/*.e2e.spec.js', '**/*.e2e.spec.jsx'],

  // Transpile ESM-only deps; the `.pnpm` skip keeps this correct under pnpm (issue #519).
  transformIgnorePatterns: ['node_modules[/\\\\](?!\\.pnpm[/\\\\])(?!(jose)[/\\\\])'],

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Coverage settings (optional, disabled by default for E2E)
  collectCoverage: false,

  // Verbose output
  verbose: true,
};
