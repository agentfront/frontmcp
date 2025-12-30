/**
 * Shared Jest E2E coverage configuration preset
 * Used by all E2E tests for consistent coverage collection across core libraries
 *
 * Note: SDK's index.ts is intentionally NOT excluded as it contains executable code
 * (import 'reflect-metadata', FlowHooksOf() calls, etc.)
 */
module.exports = {
  coverageReporters: ['json'],
  collectCoverageFrom: [
    '<rootDir>/../../../libs/sdk/src/**/*.ts',
    '<rootDir>/../../../libs/adapters/src/**/*.ts',
    '<rootDir>/../../../libs/plugins/src/**/*.ts',
    '!**/*.test.ts',
    '!**/*.spec.ts',
    // Exclude barrel exports that only re-export, but keep SDK's index.ts (has executable code)
    '!<rootDir>/../../../libs/adapters/src/index.ts',
    '!<rootDir>/../../../libs/plugins/src/index.ts',
  ],
};
