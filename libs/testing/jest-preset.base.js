/**
 * @file jest-preset.base.js
 * @description What `@frontmcp/testing/jest-preset` and `@frontmcp/testing/jest-preset-unit` share, so they cannot drift.
 */

module.exports = {
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

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // The SDK's ESM-only runtime deps: `jose` (auth) and `@noble/*` (`@frontmcp/utils` crypto). The `.pnpm` skip keeps this correct under pnpm (issue #519).
  transformIgnorePatterns: [
    'node_modules[/\\\\](?!\\.pnpm[/\\\\])(?!(jose|@noble[/\\\\]hashes|@noble[/\\\\]ciphers)[/\\\\])',
  ],

  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
