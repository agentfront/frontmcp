import { createRequire } from 'module';

import type { Config } from '@jest/types';

const require = createRequire(import.meta.url);
const e2eCoveragePreset = require('../../../jest.e2e.coverage.preset.js');

const config: Config.InitialOptions = {
  displayName: 'demo-e2e-frontmcp-config',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.e2e.spec.ts'],
  testTimeout: 60000,
  maxWorkers: 1,
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
    '^@frontmcp/cli$': '<rootDir>/../../../libs/cli/src/index.ts',
    '^@frontmcp/cli/(.*)$': '<rootDir>/../../../libs/cli/src/$1',
    '^@frontmcp/utils$': '<rootDir>/../../../libs/utils/src/index.ts',
  },
  coverageDirectory: '../../../coverage/e2e/demo-e2e-frontmcp-config',
  ...e2eCoveragePreset,
};

export default config;
