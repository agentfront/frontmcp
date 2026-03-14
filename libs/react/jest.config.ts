const { readFileSync } = require('fs');

const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@frontmcp/react',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[tj]sx?$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html'],
  coverageDirectory: '../../coverage/unit/react',
  coveragePathIgnorePatterns: [
    'src/index.ts',
    'src/types.ts',
    'src/ai/index.ts',
    'src/ai/types.ts',
    'src/components/index.ts',
    'src/hooks/index.ts',
    'src/provider/index.ts',
    'src/registry/index.ts',
    'src/router/index.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95,
    },
  },
  moduleNameMapper: {
    ...require('../../jest.imports-mapper'),
    '^@frontmcp/sdk$': '<rootDir>/../sdk/src/index.ts',
    '^@frontmcp/sdk/(.*)$': '<rootDir>/../sdk/src/$1',
  },
};
