/* eslint-disable */
export default {
  displayName: 'vectoria',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2022',
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/vectoria',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testTimeout: 60000,
};
