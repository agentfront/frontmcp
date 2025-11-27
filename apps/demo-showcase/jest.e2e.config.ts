/* eslint-disable */
export default {
  displayName: 'demo-showcase-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.e2e.ts'],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/../../libs/testing/src/setup.ts'],
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
    '^@frontmcp/testing$': '<rootDir>/../../libs/testing/src/index.ts',
    '^@frontmcp/testing/setup$': '<rootDir>/../../libs/testing/src/setup.ts',
    '^@frontmcp/sdk$': '<rootDir>/../../libs/sdk/src/index.ts',
    '^@frontmcp/adapters$': '<rootDir>/../../libs/adapters/src/index.ts',
    '^@frontmcp/plugins$': '<rootDir>/../../libs/plugins/src/index.ts',
  },
  coverageDirectory: 'test-output/jest/coverage-e2e',
};
