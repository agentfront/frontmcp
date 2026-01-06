module.exports = {
  displayName: 'plugin-codecall',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transformIgnorePatterns: ['node_modules/(?!(jose|enclave-vm)/)'],
  moduleNameMapper: {
    '^@frontmcp/sdk$': '<rootDir>/../../libs/sdk/src/index.ts',
    '^@frontmcp/plugin-cache$': '<rootDir>/../plugin-cache/src/index.ts',
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
  coverageDirectory: '../../coverage/unit/plugin-codecall',
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
