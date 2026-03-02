import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const shim = (name: string) => resolve(root, `libs/sdk/src/browser/shims/${name}.ts`);

// Node.js shim aliases for browser builds.
// Source of truth: libs/sdk/project.json#build-browser-esm
const nodeShimAliases: Record<string, string> = {
  // SWC native binaries — must be shimmed to avoid .node parse errors
  '@swc/core': shim('empty'),
  '@swc/wasm': shim('empty'),
  '@swc/core-darwin-arm64': shim('empty'),

  // Node.js built-ins — functional shims
  'node:async_hooks': shim('async-hooks'),
  'node:crypto': shim('crypto'),
  'node:events': shim('events'),
  'node:http': shim('http'),
  'node:os': shim('os'),
  'node:path': shim('path'),
  'node:stream': shim('stream'),
  'node:fs': shim('fs'),
  'node:fs/promises': shim('fs'),
  async_hooks: shim('async-hooks'),
  crypto: shim('crypto'),
  events: shim('events'),
  http: shim('http'),
  os: shim('os'),
  stream: shim('stream'),

  // Node.js built-ins — noop shims
  'node:buffer': shim('empty'),
  'node:process': shim('empty'),
  'node:child_process': shim('empty'),
  'node:url': shim('empty'),
  'node:util': shim('empty'),
  assert: shim('empty'),
  buffer: shim('empty'),
  child_process: shim('empty'),
  http2: shim('empty'),
  net: shim('empty'),
  process: shim('empty'),
  querystring: shim('empty'),
  tty: shim('empty'),
  url: shim('empty'),
  util: shim('empty'),
  worker_threads: shim('empty'),
  zlib: shim('empty'),

  // Node.js-only npm packages
  ioredis: shim('empty'),
  express: shim('empty'),
  cors: shim('empty'),
  'raw-body': shim('empty'),
  'content-type': shim('empty'),
  '@vercel/kv': shim('empty'),
  esbuild: shim('empty'),
};

export default defineConfig({
  root: __dirname,
  plugins: [react({ tsDecorators: true })],
  build: {
    outDir: resolve(root, 'dist/apps/e2e/demo-e2e-browser'),
    emptyOutDir: true,
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // Map workspace packages to source for development
      '@frontmcp/react/router': resolve(root, 'libs/react/src/router/index.ts'),
      '@frontmcp/react/ai': resolve(root, 'libs/react/src/ai/index.ts'),
      '@frontmcp/react': resolve(root, 'libs/react/src/index.ts'),
      '@frontmcp/adapters/openapi': resolve(root, 'libs/adapters/src/openapi/index.ts'),
      '@frontmcp/plugin-store': resolve(root, 'plugins/plugin-store/src/index.ts'),
      // Shim Node.js built-ins and native modules for browser
      'fs/promises': shim('fs'),
      fs: shim('fs'),
      path: shim('path'),
      ...nodeShimAliases,
    },
  },
  optimizeDeps: {
    exclude: ['@swc/core', '@swc/wasm', '@swc/core-darwin-arm64'],
  },
  server: { port: 4200, open: true },
});
