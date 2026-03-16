import { defineConfig } from 'vite';
import { resolve } from 'path';

const root = resolve(__dirname, '../../../..');

export default defineConfig({
  root: __dirname,
  resolve: {
    conditions: ['browser', 'development', 'import'],
    alias: [
      // @frontmcp/* → source files for local development (matches demo-e2e-browser-bundle pattern)
      { find: '@frontmcp/sdk', replacement: resolve(root, 'libs/sdk/src/index.ts') },
      { find: '@frontmcp/utils', replacement: resolve(root, 'libs/utils/src/index.ts') },
      { find: '@frontmcp/auth', replacement: resolve(root, 'libs/auth/src/index.ts') },
      { find: '@frontmcp/di', replacement: resolve(root, 'libs/di/src/index.ts') },
      { find: '@frontmcp/protocol', replacement: resolve(root, 'libs/protocol/src/index.ts') },
    ],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  server: {
    port: 4402,
  },
  preview: {
    port: 4402,
  },
  build: {
    outDir: resolve(root, 'dist/apps/e2e/demo-e2e-esm-browser'),
    emptyOutDir: true,
    rollupOptions: {
      shimMissingExports: true,
      onwarn(warning, warn) {
        // Suppress circular dependency warnings from reflect-metadata
        if (warning.code === 'CIRCULAR_DEPENDENCY') return;
        // Suppress missing export warnings (type-only re-exports erased by esbuild)
        if (warning.code === 'MISSING_EXPORT') return;
        warn(warning);
      },
    },
  },
});
