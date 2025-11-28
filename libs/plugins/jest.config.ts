/* eslint-disable */
export default {
  displayName: '@frontmcp/plugins',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2022',
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
  moduleFileExtensions: ['ts', 'js', 'html', 'node'],
  transformIgnorePatterns: ['node_modules/(?!(isolated-vm|jose)/)'],
  moduleNameMapper: {
    '^@frontmcp/sdk$': '<rootDir>/../../libs/sdk/src/index.ts',
  },
  coverageDirectory: 'test-output/jest/coverage',
};
