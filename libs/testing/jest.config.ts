/* eslint-disable */
module.exports = {
  displayName: '@frontmcp/testing',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', { sourceMaps: 'inline' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/testing',
  passWithNoTests: true,
};
