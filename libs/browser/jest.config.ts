const swcConfig = {
  jsc: {
    target: 'es2022',
    parser: {
      syntax: 'typescript',
      tsx: true,
      decorators: true,
      dynamicImport: true,
    },
    transform: {
      decoratorMetadata: true,
      legacyDecorator: true,
      react: {
        runtime: 'automatic',
      },
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
};

const baseConfig = {
  preset: '../../jest.preset.js',
  transform: {
    '^.+\\.[tj]sx?$': ['@swc/jest', swcConfig],
  },
  transformIgnorePatterns: ['node_modules/(?!(jose|valtio|idb)/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
};

export default {
  displayName: '@frontmcp/browser',
  coverageDirectory: 'test-output/jest/coverage',
  projects: [
    {
      ...baseConfig,
      displayName: 'browser-node',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/src/host/', '/src/react/'],
    },
    {
      ...baseConfig,
      displayName: 'browser-jsdom',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/host/**/*.spec.ts', '<rootDir>/src/react/**/*.spec.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/test-setup-jsdom.ts'],
    },
  ],
};
