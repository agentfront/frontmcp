import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@frontmcp/skills', message: 'Do not self-import. Use relative paths.' }],
        patterns: [{ group: ['@frontmcp/skills/*'], message: 'Do not self-import. Use relative paths.' }],
      }],
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
