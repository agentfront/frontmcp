module.exports = {
  displayName: 'edge',
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
  moduleFileExtensions: ['ts', 'js', 'html'],
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  // Resolve the SDK to its built CJS bundle (self-contained) rather than source,
  // so this package's test doesn't need to mirror the SDK's own jest mappings
  // for its whole dependency graph. The `test` target dependsOn `sdk:build`.
  moduleNameMapper: {
    '^@frontmcp/sdk$': '<rootDir>/../sdk/dist/index.js',
  },
  coverageDirectory: '../../coverage/unit/edge',
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 50,
      functions: 80,
      lines: 70,
    },
  },
};
