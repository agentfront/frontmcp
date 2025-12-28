module.exports = {
  displayName: '@frontmcp/adapters',
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
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/adapters',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
    '!src/**/*.d.ts',
    '!src/**/*.types.ts', // Exclude type definition files from coverage
  ],
  // Override coverage thresholds for adapters package
  // Lower thresholds account for untestable decorator metadata and class properties
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 85,
      functions: 80,
      lines: 90,
    },
  },
};
