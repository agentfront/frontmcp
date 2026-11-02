import { createRequire } from 'module';

import type { Config } from '@jest/types';

const require = createRequire(import.meta.url);
const e2eCoveragePreset: Config.InitialOptions = require('../../../jest.e2e.coverage.preset.js');

const config: Config.InitialOptions = {
  displayName: 'demo-e2e-local-runtime',
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
  ...e2eCoveragePreset,
  coverageDirectory: '../../../coverage/e2e/demo-e2e-local-runtime',
};

export default config;
