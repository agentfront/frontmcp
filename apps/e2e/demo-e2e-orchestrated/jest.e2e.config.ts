import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const e2eCoveragePreset = require('../../../jest.e2e.coverage.preset.js');

export default {
  displayName: 'demo-e2e-orchestrated',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.e2e.test.ts'],
  testTimeout: 60000,
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/../../../libs/testing/src/setup.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2017',
          parser: {
            syntax: 'typescript',
            decorators: true,
            dynamicImport: true,
          },
          transform: {
            decoratorMetadata: true,
            legacyDecorator: true,
          },
          keepClassNames: true,
          externalHelpers: true,
          loose: true,
        },
        module: {
          type: 'es6',
        },
        sourceMaps: true,
        swcrc: false,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  moduleNameMapper: {
    '^@frontmcp/testing$': '<rootDir>/../../../libs/testing/src/index.ts',
    '^@frontmcp/testing/setup$': '<rootDir>/../../../libs/testing/src/setup.ts',
    '^@frontmcp/sdk$': '<rootDir>/../../../libs/sdk/src/index.ts',
    '^@frontmcp/sdk/(.*)$': '<rootDir>/../../../libs/sdk/src/$1',
    '^@frontmcp/adapters$': '<rootDir>/../../../libs/adapters/src/index.ts',
    '^@frontmcp/plugins$': '<rootDir>/../../../libs/plugins/src/index.ts',
    '^@frontmcp/auth$': '<rootDir>/../../../libs/auth/src/index.ts',
    '^@frontmcp/utils$': '<rootDir>/../../../libs/utils/src/index.ts',
  },
  coverageDirectory: '../../../coverage/e2e/demo-e2e-orchestrated',
  ...e2eCoveragePreset,
};
