module.exports = {
  displayName: '@frontmcp/storage-sqlite',
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
  moduleNameMapper: {
    '^@frontmcp/utils$': '<rootDir>/../utils/src/index.ts',
    '^@frontmcp/utils/crypto/node$': '<rootDir>/../utils/src/crypto/node.ts',
  },
  coverageDirectory: '../../coverage/unit/storage-sqlite',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageThreshold: {
    global: {
      statements: 91,
      branches: 78,
      functions: 93,
      lines: 92,
    },
  },
};
