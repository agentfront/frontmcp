import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  displayName: 'demo-e2e-guard-cli',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/guard-cli.e2e.spec.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/../../../libs/testing/src/setup.ts'],
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
            decorators: true,
          },
          transform: {
            decoratorMetadata: true,
          },
          target: 'es2022',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@frontmcp/testing$': '<rootDir>/../../../libs/testing/src/index.ts',
    '^@frontmcp/sdk$': '<rootDir>/../../../libs/sdk/src/index.ts',
    '^@frontmcp/guard$': '<rootDir>/../../../libs/guard/src/index.ts',
  },
};

export default config;
