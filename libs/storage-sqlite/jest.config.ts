const project = {
  displayName: '@frontmcp/storage-sqlite',
  rootDir: __dirname,
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
    ...require('../../jest.imports-mapper'),
    '^@frontmcp/utils$': '<rootDir>/../utils/src/index.ts',
    '^@frontmcp/utils/crypto/node$': '<rootDir>/../utils/src/crypto/node.ts',
    '^@frontmcp/guard$': '<rootDir>/../guard/src/index.ts',
  },
};

module.exports = {
  // Every spec runs twice: on better-sqlite3, and on node:sqlite.
  projects: [
    project,
    {
      ...project,
      displayName: '@frontmcp/storage-sqlite (node:sqlite)',
      setupFiles: ['<rootDir>/src/__test-utils__/use-node-sqlite.ts'],
      // Type checks of the better-sqlite3 members `openDatabase()` and `getDatabase()` expose.
      testPathIgnorePatterns: ['/node_modules/', 'public-database-types\\.spec\\.ts$'],
    },
  ],
  coverageDirectory: '../../coverage/unit/storage-sqlite',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageThreshold: {
    global: {
      statements: 90,
      // better-sqlite3 native module constructor error paths have limited testability in Jest
      branches: 78,
      functions: 90,
      lines: 90,
    },
  },
};
