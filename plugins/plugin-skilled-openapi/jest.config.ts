module.exports = {
  displayName: 'plugin-skilled-openapi',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  moduleNameMapper: {
    ...require('../../jest.imports-mapper'),
    '^@frontmcp/sdk$': '<rootDir>/../../libs/sdk/src/index.ts',
    '^@frontmcp/adapters/openapi$': '<rootDir>/../../libs/adapters/src/openapi/index.ts',
    '^@frontmcp/adapters/skills$': '<rootDir>/../../libs/adapters/src/skills/index.ts',
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
      // Thresholds reflect the achievable plateau for v1.2 — the saas-pull
      // schedulePoll branches and skilled-openapi.plugin DI bootstrap are
      // exercised end-to-end in the demo app rather than unit-tested.
      statements: 92,
      branches: 87,
      functions: 87,
      lines: 93,
    },
  },
  setupFilesAfterEnv: ['reflect-metadata'],
};
