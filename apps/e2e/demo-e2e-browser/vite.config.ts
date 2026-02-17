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
  server: { port: 4200, open: true },
});
