const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@frontmcp/sdk',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  // Limit workers to avoid SIGSEGV crashes on Node.js 24+
  maxWorkers: '50%',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/sdk',
  // SDK has extensive coverage gaps - using lower threshold for incremental improvement
  // TODO: Increase thresholds as more tests are added
  coverageThreshold: {
    global: {
      statements: 38,
      branches: 22,
      functions: 36,
      lines: 38,
    },
  },
  // Only collect coverage from SDK source files
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    // Exclude test utilities - they shouldn't be counted for coverage
    '!src/__test-utils__/**',
  ],
  // Map @frontmcp/uipack imports to the built dist for tests
  moduleNameMapper: {
    '^@frontmcp/uipack$': '<rootDir>/../uipack/dist/index.js',
    '^@frontmcp/uipack/(.*)$': '<rootDir>/../uipack/dist/$1/index.js',
    '^@frontmcp/ui$': '<rootDir>/../ui/dist/index.js',
    '^@frontmcp/ui/(.*)$': '<rootDir>/../ui/dist/$1/index.js',
    '^@frontmcp/utils$': '<rootDir>/../utils/src/index.ts',
    '^@frontmcp/utils/crypto/node$': '<rootDir>/../utils/src/crypto/node.ts',
  },
};
