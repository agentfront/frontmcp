import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');

export default defineConfig({
  root: __dirname,
  plugins: [react({ tsDecorators: true })],
  build: {
    outDir: resolve(root, 'dist/apps/e2e/demo-e2e-browser'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // Map workspace packages to source for development
      '@frontmcp/react/router': resolve(root, 'libs/react/src/router/index.ts'),
      '@frontmcp/react/ai': resolve(root, 'libs/react/src/ai/index.ts'),
      '@frontmcp/react': resolve(root, 'libs/react/src/index.ts'),
      '@frontmcp/adapters/openapi': resolve(root, 'libs/adapters/src/openapi/index.ts'),
      '@frontmcp/plugin-store': resolve(root, 'plugins/plugin-store/src/index.ts'),
      // Shim Node.js built-ins for browser (needed by mcp-from-openapi)
      'fs/promises': resolve(root, 'libs/sdk/src/browser/shims/fs.ts'),
      fs: resolve(root, 'libs/sdk/src/browser/shims/fs.ts'),
      path: resolve(root, 'libs/sdk/src/browser/shims/path.ts'),
      'node:fs': resolve(root, 'libs/sdk/src/browser/shims/fs.ts'),
      'node:fs/promises': resolve(root, 'libs/sdk/src/browser/shims/fs.ts'),
      'node:path': resolve(root, 'libs/sdk/src/browser/shims/path.ts'),
    },
  },
  server: { port: 4200, open: true },
});
