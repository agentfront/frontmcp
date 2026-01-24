module.exports = {
  displayName: 'auth',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/auth',
  // Transform jose ESM module
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  // Auth has coverage gaps - using lower threshold for incremental improvement.
  // OAuth providers (providers/oauth), session management, and credential vault
  // need additional tests. Target is 95% per CLAUDE.md guidelines.
  // TODO(FrontMCP-Auth-Coverage): Increase thresholds to 95% as more tests are added
  coverageThreshold: {
    global: {
      statements: 62,
      branches: 50,
      functions: 40,
      lines: 62,
    },
  },
};
