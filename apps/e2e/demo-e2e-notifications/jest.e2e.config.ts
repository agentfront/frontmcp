export default {
  displayName: 'demo-e2e-notifications-e2e',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.app.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/e2e/**/*.e2e.test.ts'],
  coverageDirectory: '../../../coverage/apps/e2e/demo-e2e-notifications-e2e',
  moduleNameMapper: {
    '^@frontmcp/sdk$': '<rootDir>/../../../libs/sdk/src/index.ts',
    '^@frontmcp/testing$': '<rootDir>/../../../libs/testing/src/index.ts',
    '^@frontmcp/adapters$': '<rootDir>/../../../libs/adapters/src/index.ts',
    '^@frontmcp/plugins$': '<rootDir>/../../../libs/plugins/src/index.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/../../../libs/testing/src/jest-setup.ts'],
};
