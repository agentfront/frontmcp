const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@frontmcp/sdk',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/sdk',
  // Map @frontmcp/uipack imports to the built dist for tests
  moduleNameMapper: {
    '^@frontmcp/uipack$': '<rootDir>/../uipack/dist/index.js',
    '^@frontmcp/uipack/(.*)$': '<rootDir>/../uipack/dist/$1/index.js',
    '^@frontmcp/ui$': '<rootDir>/../ui/dist/index.js',
    '^@frontmcp/ui/(.*)$': '<rootDir>/../ui/dist/$1/index.js',
  },
};
