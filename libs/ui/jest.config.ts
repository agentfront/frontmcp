const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@frontmcp/ui',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html'],
  coverageDirectory: '../../coverage/unit/ui',
  coverageThreshold: {
    global: {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
    },
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    // Web component tests need jsdom or browser environment
    '/src/web-components/core/base-element.spec.ts',
    '/src/web-components/elements/elements.spec.ts',
  ],
  // Map @frontmcp/uipack imports to the built dist for tests
  moduleNameMapper: {
    ...require('../../jest.imports-mapper'),
    '^@frontmcp/uipack$': '<rootDir>/../uipack/dist/index.js',
    '^@frontmcp/uipack/(.*)$': '<rootDir>/../uipack/dist/$1/index.js',
  },
};
