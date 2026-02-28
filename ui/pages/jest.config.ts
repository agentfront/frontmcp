const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@frontmcp/ui-pages',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[tj]sx?$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html'],
  coverageDirectory: '../../coverage/unit/ui-pages',
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
    '^@frontmcp/ui$': '<rootDir>/../../libs/ui/dist/index.js',
    '^@frontmcp/ui/(.*)$': '<rootDir>/../../libs/ui/dist/$1/index.js',
    '^@frontmcp/ui-components$': '<rootDir>/../components/dist/index.js',
    '^@frontmcp/ui-components/(.*)$': '<rootDir>/../components/dist/$1/index.js',
  },
};
