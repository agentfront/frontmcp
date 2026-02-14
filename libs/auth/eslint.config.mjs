import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          ignoredDependencies: [
            '@vercel/kv', // Optional: lazy-required in vercel-kv-session.store.ts
            '@frontmcp/storage-sqlite', // Optional: lazy-required in session-store.factory
            'jose', // Used via dynamic require in token verification
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
