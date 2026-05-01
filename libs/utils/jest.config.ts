module.exports = {
  displayName: 'utils',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transformIgnorePatterns: ['/node_modules/(?!(@noble/hashes|@noble/ciphers)/)'],
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2022',
          parser: {
            syntax: 'typescript',
            dynamicImport: true,
          },
          keepClassNames: true,
          externalHelpers: true,
          loose: true,
        },
        module: {
          type: 'es6',
        },
        sourceMaps: true,
        swcrc: false,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/utils',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/types.ts',
    '!src/**/*.types.ts',
    // Pure runtime-bound re-exports — single line, nothing to test
    '!src/async-context/node-async-context.ts',
    '!src/path/node-path.ts',
    // Browser-only entrypoints — never imported by the Node test runner
    '!src/async-context/browser-async-context.ts',
    '!src/env/browser-runtime-context.ts',
    '!src/event-emitter/browser-event-emitter.ts',
    '!src/crypto/browser.ts',
    '!src/path/browser-path.ts',
    '!src/storage/adapters/indexeddb.ts',
    '!src/storage/adapters/localstorage.ts',
    // Module-load IIFE that resolves machine ID by deployment mode. The
    // standalone (file-persistence) branch is unreachable in tests because
    // modern Node exposes `globalThis.crypto.getRandomValues`, which makes
    // `isBrowser()` return true and short-circuits dev persistence. Covered
    // by integration tests against a built artifact.
    '!src/machine-id/machine-id.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 89, // Reduced from 90% due to browser-specific code paths that can't be tested in Node.js
      functions: 90,
      lines: 90,
    },
  },
};
