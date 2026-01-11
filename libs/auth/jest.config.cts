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
  // TODO: Raise coverage thresholds to 95% (current values are temporary)
  coverageThreshold: {
    global: {
      statements: 65, // Target: 95
      branches: 60, // Target: 95
      functions: 40, // Target: 95
      lines: 65, // Target: 95
    },
  },
};
