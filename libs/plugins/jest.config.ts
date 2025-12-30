module.exports = {
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
  transformIgnorePatterns: ['node_modules/(?!(isolated-vm|jose|enclave-vm|ast-guard)/)'],
  moduleNameMapper: {
    '^@frontmcp/sdk$': '<rootDir>/../../libs/sdk/src/index.ts',
  },
  coverageDirectory: '../../coverage/unit/plugins',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
    '!src/**/*.d.ts',
    '!src/**/*.types.ts', // Exclude type definition files from coverage
  ],
  // Override coverage thresholds for plugins package
  // Lower thresholds than the default 90% account for:
  // - Decorator metadata that is untestable in isolation
  // - Plugin hooks that require full framework integration to test
  // - Enclave/sandbox code that needs isolated-vm runtime
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
  },
};
