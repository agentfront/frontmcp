const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@frontmcp/ui-shells',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/ui-shells',
  coverageThreshold: {
    global: {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
    },
  },
  testPathIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    '^@frontmcp/uipack$': '<rootDir>/../../libs/uipack/dist/index.js',
    '^@frontmcp/uipack/(.*)$': '<rootDir>/../../libs/uipack/dist/$1/index.js',
  },
};
