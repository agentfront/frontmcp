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
            '@swc/core', // Optional: used by SWC-based bundler at runtime
            'react-dom', // Peer dep required for React rendering
            '@emotion/react', // Peer dep required by @mui/material
            '@emotion/styled', // Peer dep required by @mui/material
            'react-pdf', // Optional peer dep: lazy-loaded by pdf renderer
            'pdfjs-dist', // Optional peer dep: lazy-loaded by pdf renderer
            'recharts', // Optional peer dep: lazy-loaded by charts renderer
            'react-markdown', // Optional peer dep: lazy-loaded by mdx renderer
            'remark-gfm', // Optional peer dep: lazy-loaded by mdx renderer
            'rehype-highlight', // Optional peer dep: lazy-loaded by mdx renderer
            'rehype-raw', // Optional peer dep: lazy-loaded by mdx renderer
            'mermaid', // Optional peer dep: lazy-loaded by mdx renderer
            '@xyflow/react', // Optional peer dep: lazy-loaded by flow renderer
            'katex', // Optional peer dep: lazy-loaded by mdx renderer
            'react-leaflet', // Optional peer dep: lazy-loaded by maps renderer
            'leaflet', // Optional peer dep: lazy-loaded by maps renderer
            'react-player', // Optional peer dep: lazy-loaded by media renderer
            'dompurify', // Optional peer dep: lazy-loaded for HTML sanitization
          ],
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
