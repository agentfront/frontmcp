module.exports = {
  displayName: 'lazy-zod',
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
  coverageDirectory: '../../coverage/unit/lazy-zod',
  coveragePathIgnorePatterns: ['/__tests__/', 'src/index.ts'],
  coverageThreshold: {
    global: {
      // Namespace declarations and the class-detection heuristic in the
      // Proxy `get` fallback are hard to exercise exhaustively without
      // pulling in every realistic zod schema shape the world knows.
      // Thresholds reflect realistic achievable coverage for this lib;
      // the POC + full drop-in-parity suite covers functional behavior.
      statements: 90,
      branches: 80,
      functions: 95,
      lines: 90,
    },
  },
};
