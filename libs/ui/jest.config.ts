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
  coverageDirectory: 'test-output/jest/coverage',
  testPathIgnorePatterns: ['/node_modules/'],
  // Map @frontmcp/uipack imports to the built dist for tests
  moduleNameMapper: {
    '^@frontmcp/uipack$': '<rootDir>/../uipack/dist/index.js',
    '^@frontmcp/uipack/(.*)$': '<rootDir>/../uipack/dist/$1/index.js',
  },
};
