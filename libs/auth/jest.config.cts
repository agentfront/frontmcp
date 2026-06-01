module.exports = {
  displayName: 'auth',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/auth',
  // Run coverage single-worker for determinism. Under parallel workers a pre-existing
  // worker-teardown force-exit (no persistent open handle — all cleanup timers already
  // call .unref()) can drop a whole suite's coverage, flaking the global thresholds.
  // Normal `nx test auth` stays parallel/fast; only `--coverage` forces one worker.
  ...(process.argv.some((arg) => arg.includes('coverage')) ? { maxWorkers: 1 } : {}),
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
