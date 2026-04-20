import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // Built bundles and generated results are not source — skip lint.
    ignores: ['results/**', 'dist/**', 'src/schemas/eager.ts', 'src/schemas/lazy.ts'],
  },
];
