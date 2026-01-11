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
  // Coverage thresholds - can be increased as more tests are added
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 60,
      functions: 40,
      lines: 65,
    },
  },
};
