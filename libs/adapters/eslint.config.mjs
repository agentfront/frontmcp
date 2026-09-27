import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            // Test helpers aren't built (tsconfig.lib.json excludes them), so their imports aren't runtime dependencies.
            '{projectRoot}/src/**/__tests__/**',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Allow mcp-from-openapi imports despite being mocked in tests
      '@nx/enforce-module-boundaries': ['error', { allow: ['mcp-from-openapi'] }],
      // Block self-referencing package import
      'no-restricted-imports': ['error', {
        paths: [{ name: '@frontmcp/adapters', message: 'Do not self-import. Use relative paths.' }],
        patterns: [{ group: ['@frontmcp/adapters/*'], message: 'Do not self-import. Use relative paths.' }],
      }],
    },
  },
  {
    ignores: ['**/out-tsc', '**/__tests__'],
  },
];
