/** Jest preset for unit tests, CommonJS projects included; the @frontmcp/testing README shows how to use it. */

const base = require('./jest-preset.base.js');

module.exports = {
  ...base,

  testMatch: ['<rootDir>/**/*.spec.ts', '<rootDir>/**/*.spec.tsx'],

  testPathIgnorePatterns: [...base.testPathIgnorePatterns, '\\.(e2e|perf|pw)\\.spec\\.tsx?$'],
};
