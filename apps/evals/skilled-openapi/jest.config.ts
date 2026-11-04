import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  displayName: 'evals-skilled-openapi',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testTimeout: 120_000,
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { decoratorMetadata: true },
          target: 'es2022',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@frontmcp/testing$': '<rootDir>/../../../libs/testing/src/index.ts',
    '^@frontmcp/sdk$': '<rootDir>/../../../libs/sdk/src/index.ts',
    '^@frontmcp/adapters/skills$': '<rootDir>/../../../libs/adapters/src/skills/index.ts',
    '^@frontmcp/auth$': '<rootDir>/../../../libs/auth/src/index.ts',
    '^@frontmcp/utils$': '<rootDir>/../../../libs/utils/src/index.ts',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
  coverageDirectory: '../../../coverage/unit/evals-skilled-openapi',
};

export default config;
