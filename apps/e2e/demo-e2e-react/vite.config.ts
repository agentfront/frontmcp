import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['browser', 'development', 'import'],
    alias: [
      // @frontmcp/react sub-paths (must come before the base alias)
      { find: '@frontmcp/react/state', replacement: resolve(root, 'libs/react/src/state/index.ts') },
      { find: '@frontmcp/react/api', replacement: resolve(root, 'libs/react/src/api/index.ts') },

      // @frontmcp/* base paths → source files
      { find: '@frontmcp/react', replacement: resolve(root, 'libs/react/src/index.ts') },
      { find: '@frontmcp/sdk', replacement: resolve(root, 'libs/sdk/src/index.ts') },
      { find: '@frontmcp/utils', replacement: resolve(root, 'libs/utils/src/index.ts') },
      { find: '@frontmcp/auth', replacement: resolve(root, 'libs/auth/src/index.ts') },
      { find: '@frontmcp/di', replacement: resolve(root, 'libs/di/src/index.ts') },
    ],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  server: {
    port: 4402,
    fs: {
      allow: [root],
    },
  },
  build: {
    outDir: resolve(root, 'dist/apps/e2e/demo-e2e-react'),
    emptyOutDir: true,
    rollupOptions: {
      shimMissingExports: true,
      onwarn(warning, warn) {
        if (warning.code === 'CIRCULAR_DEPENDENCY') return;
        if (warning.code === 'MISSING_EXPORT') return;
        warn(warning);
      },
    },
  },
});
