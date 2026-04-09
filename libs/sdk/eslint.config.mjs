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
          // LangChain packages are used in agent/adapters but nx checker doesn't trace through internal imports
          ignoredDependencies: [
            '@types/cors', // Type-only dep for CORS options typing
            '@langchain/core', // Used in langchain.adapter.ts
            '@langchain/openai', // Used in providers/index.ts for built-in OpenAI support
            '@langchain/anthropic', // Used in providers/index.ts for built-in Anthropic support
            '@langchain/google-genai', // Optional: dynamic import
            '@langchain/mistralai', // Optional: dynamic import
            '@langchain/groq', // Optional: dynamic import
            'openai', // Optional peer dep: dynamic import in agent adapters
            '@anthropic-ai/sdk', // Optional peer dep: dynamic import in agent adapters
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
      'no-restricted-imports': ['error', {
        paths: [{ name: '@frontmcp/sdk', message: 'Do not self-import. Use relative paths.' }],
        patterns: [{ group: ['@frontmcp/sdk/*'], message: 'Do not self-import. Use relative paths.' }],
      }],
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
