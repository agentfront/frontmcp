module.exports = {
  displayName: '@frontmcp/skills',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
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
  coverageDirectory: '../../coverage/unit/skills',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageThreshold: {
    global: {
      statements: 95,
      // The single uncovered branch is inside a complex type-cast
      // (`s.bundle?.includes(bundle as ... extends ... ? U : never)`)
      // that Istanbul tracks as a binary-expr but reports as
      // unreachable from tests; manifest- and filter-level coverage
      // is otherwise complete.
      branches: 80,
      functions: 95,
      lines: 95,
    },
  },
};
