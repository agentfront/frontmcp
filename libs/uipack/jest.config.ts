const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@frontmcp/uipack',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
  // Setup file for web component tests - mocks HTMLElement before imports
  setupFilesAfterEnv: ['<rootDir>/src/web-components/__tests__/setup.ts'],
  // Exclude web component tests from regular run - they need special setup
  testPathIgnorePatterns: [
    '/node_modules/',
    // Web component tests are temporarily excluded - they need jsdom or browser environment
    '/src/web-components/core/base-element.test.ts',
    '/src/web-components/elements/elements.test.ts',
  ],
};
