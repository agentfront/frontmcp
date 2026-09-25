import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  displayName: 'demo-e2e-dts-consumer',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.e2e.spec.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2022',
        },
      },
    ],
  },
};

export default config;
