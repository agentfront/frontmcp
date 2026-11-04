import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // The harness runs the Skilled OpenAPI e2e app's mock billing API, signed bundle and server entry.
      '@nx/enforce-module-boundaries': [
        'error',
        { allow: ['^(\\.\\./)+e2e/demo-e2e-skilled-openapi/e2e/helpers/[\\w-]+$'] },
      ],
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
