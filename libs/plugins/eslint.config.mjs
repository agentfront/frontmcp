import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@frontmcp/plugins', message: 'Do not self-import. Use relative paths.' }],
        patterns: [{ group: ['@frontmcp/plugins/*'], message: 'Do not self-import. Use relative paths.' }],
      }],
    },
  },
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/**/*.test.ts',
            '{projectRoot}/**/*.spec.ts',
          ],
          // A peer the re-exported plugins resolve from the app, not one this package imports.
          ignoredDependencies: ['@frontmcp/sdk'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
