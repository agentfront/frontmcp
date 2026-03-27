import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
