import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  displayName: 'demo-e2e-notifications-perf',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.perf.test.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  setupFilesAfterEnv: [
    '<rootDir>/../../../libs/testing/src/setup.ts',
    '<rootDir>/../../../libs/testing/src/perf/perf-setup.ts',
  ],
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
    '^@frontmcp/adapters$': '<rootDir>/../../../libs/adapters/src/index.ts',
    '^@frontmcp/utils$': '<rootDir>/../../../libs/utils/src/index.ts',
  },
  reporters: [
    'default',
    [
      '<rootDir>/../../../libs/testing/src/perf/jest-perf-reporter.js',
      {
        outputDir: 'perf-results/demo-e2e-notifications',
        baselinePath: 'perf-results/baseline.json',
        verbose: true,
      },
    ],
  ],
};

export default config;
