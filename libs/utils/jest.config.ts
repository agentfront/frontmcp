module.exports = {
  displayName: 'utils',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transformIgnorePatterns: ['/node_modules/(?!(@noble/hashes|@noble/ciphers)/)'],
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
  coverageDirectory: '../../coverage/unit/utils',
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 89, // Reduced from 90% due to browser-specific code paths that can't be tested in Node.js
      functions: 90,
      lines: 90,
    },
  },
};
