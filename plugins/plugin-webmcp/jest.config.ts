module.exports = {
  displayName: 'plugin-webmcp',
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
            dynamicImport: true,
            decorators: true,
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
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  moduleNameMapper: {
    ...require('../../jest.imports-mapper'),
    '^@frontmcp/sdk$': '<rootDir>/../../libs/sdk/src/index.ts',
    // One @frontmcp/utils for the plugin and the SDK source, so a mocked `#async-context` reaches both
    '^@frontmcp/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@frontmcp/utils/crypto/node$': '<rootDir>/../../libs/utils/src/crypto/node.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/plugin-webmcp',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.d.ts', '!src/**/__tests__/**'],
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95,
    },
  },
  setupFilesAfterEnv: ['reflect-metadata'],
};
