module.exports = {
  displayName: 'plugin-skilled-openapi',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  moduleNameMapper: {
    ...require('../../jest.imports-mapper'),
    '^@frontmcp/sdk$': '<rootDir>/../../libs/sdk/src/index.ts',
    '^@frontmcp/adapters/openapi$': '<rootDir>/../../libs/adapters/src/openapi/index.ts',
    '^@frontmcp/auth$': '<rootDir>/../../libs/auth/src/index.ts',
    '^@frontmcp/utils$': '<rootDir>/../../libs/utils/src/index.ts',
  },
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
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/plugin-skilled-openapi',
  coverageThreshold: {
    global: {
      statements: 93,
      branches: 87,
      functions: 88,
      lines: 94,
    },
  },
  setupFilesAfterEnv: ['reflect-metadata'],
};
