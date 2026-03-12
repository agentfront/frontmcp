import { defineConfig } from 'vite';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');

export default defineConfig({
  root: __dirname,
  resolve: {
    conditions: ['browser', 'development', 'import'],
    alias: [
      // @frontmcp/uipack sub-paths (must come before the base alias)
      { find: '@frontmcp/uipack/adapters', replacement: resolve(root, 'libs/uipack/src/adapters/index.ts') },
      { find: '@frontmcp/uipack/types', replacement: resolve(root, 'libs/uipack/src/types/index.ts') },
      { find: '@frontmcp/uipack/resolver', replacement: resolve(root, 'libs/uipack/src/resolver/index.ts') },
      { find: '@frontmcp/uipack/utils', replacement: resolve(root, 'libs/uipack/src/utils/index.ts') },
      { find: '@frontmcp/uipack/shell', replacement: resolve(root, 'libs/uipack/src/shell/index.ts') },
      { find: '@frontmcp/uipack/build', replacement: resolve(root, 'libs/uipack/src/build/index.ts') },
      { find: '@frontmcp/uipack/runtime', replacement: resolve(root, 'libs/uipack/src/runtime/index.ts') },
      {
        find: '@frontmcp/uipack/bridge-runtime',
        replacement: resolve(root, 'libs/uipack/src/bridge-runtime/index.ts'),
      },
      { find: '@frontmcp/uipack/registry', replacement: resolve(root, 'libs/uipack/src/registry/index.ts') },
      { find: '@frontmcp/uipack/dependency', replacement: resolve(root, 'libs/uipack/src/dependency/index.ts') },
      { find: '@frontmcp/uipack/handlebars', replacement: resolve(root, 'libs/uipack/src/handlebars/index.ts') },
      { find: '@frontmcp/uipack/typings', replacement: resolve(root, 'libs/uipack/src/typings/index.ts') },
      { find: '@frontmcp/uipack/bundler', replacement: resolve(root, 'libs/uipack/src/bundler/index.ts') },
      { find: '@frontmcp/uipack/theme', replacement: resolve(root, 'libs/uipack/src/theme/index.ts') },
      { find: '@frontmcp/uipack/styles', replacement: resolve(root, 'libs/uipack/src/styles/index.ts') },
      { find: '@frontmcp/uipack/tool-template', replacement: resolve(root, 'libs/uipack/src/tool-template/index.ts') },
      { find: '@frontmcp/uipack/base-template', replacement: resolve(root, 'libs/uipack/src/base-template/index.ts') },
      { find: '@frontmcp/uipack/validation', replacement: resolve(root, 'libs/uipack/src/validation/index.ts') },
      { find: '@frontmcp/uipack/component', replacement: resolve(root, 'libs/uipack/src/component/index.ts') },
      { find: '@frontmcp/uipack/renderers', replacement: resolve(root, 'libs/uipack/src/renderers/index.ts') },

      // @frontmcp/* base paths → source files (development-only, not needed by published packages)
      { find: '@frontmcp/uipack', replacement: resolve(root, 'libs/uipack/src/index.ts') },
      { find: '@frontmcp/sdk', replacement: resolve(root, 'libs/sdk/src/index.ts') },
      { find: '@frontmcp/utils', replacement: resolve(root, 'libs/utils/src/index.ts') },
      { find: '@frontmcp/auth', replacement: resolve(root, 'libs/auth/src/index.ts') },
      { find: '@frontmcp/di', replacement: resolve(root, 'libs/di/src/index.ts') },
    ],
  },
  define: {
    // Ensure process.env fallback for any code that slipped through
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  server: {
    port: 4401,
  },
  preview: {
    port: 4401,
  },
  build: {
    outDir: resolve(root, 'dist/apps/e2e/demo-e2e-browser-bundle'),
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
