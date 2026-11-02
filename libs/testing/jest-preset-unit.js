/**
 * @file jest-preset-unit.js
 * @description Jest preset for unit tests in a CommonJS project: the transforms of `@frontmcp/testing/jest-preset`,
 * including `jose` and `@noble/*`, with Jest's default timeout, no setup file, and `*.spec.ts(x)` other than
 * `.e2e.spec`, `.perf.spec` and `.pw.spec` files.
 *
 * Usage in jest.config.js:
 * ```javascript
 * module.exports = {
 *   preset: '@frontmcp/testing/jest-preset-unit',
 *   // With ts-jest, override `.ts` only, so the preset still compiles the ESM-only `.js` dependencies:
 *   transform: { '^.+\\.tsx?$': 'ts-jest' },
 * };
 * ```
 */

const base = require('./jest-preset.base.js');

module.exports = {
  ...base,

  testMatch: ['<rootDir>/**/*.spec.ts', '<rootDir>/**/*.spec.tsx'],

  testPathIgnorePatterns: [...base.testPathIgnorePatterns, '\\.(e2e|perf|pw)\\.spec\\.tsx?$'],
};
