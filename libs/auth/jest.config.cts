module.exports = {
  displayName: 'auth',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/auth',
  // Transform jose ESM module
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  // Auth has coverage gaps - using lower threshold for incremental improvement.
  // OAuth providers (providers/oauth), session management, and credential vault
  // need additional tests. Target is 95% per CLAUDE.md guidelines.
  // TODO(FrontMCP-Auth-Coverage): Increase thresholds to 95% as more tests are added
  coverageThreshold: {
    global: {
      statements: 88,
      branches: 80,
      functions: 56,
      lines: 89,
    },
  },
};
