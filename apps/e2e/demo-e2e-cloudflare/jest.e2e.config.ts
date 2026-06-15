import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  displayName: 'demo-e2e-cloudflare',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.e2e.spec.ts'],
  // Cold wrangler bundling + workerd startup can take a while on CI.
  testTimeout: 180000,
  maxWorkers: 1,
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { decoratorMetadata: true },
          target: 'es2022',
        },
      },
    ],
  },
};

export default config;
