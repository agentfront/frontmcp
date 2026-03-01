import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@frontmcp/ui/renderer': resolve(root, 'libs/ui/src/renderer/index.ts'),
      '@frontmcp/ui/renderer/common': resolve(root, 'libs/ui/src/renderer/common/index.ts'),
      '@frontmcp/ui/renderer/charts': resolve(root, 'libs/ui/src/renderer/charts/index.ts'),
      '@frontmcp/ui/renderer/mermaid': resolve(root, 'libs/ui/src/renderer/mermaid/index.ts'),
      '@frontmcp/ui/renderer/flow': resolve(root, 'libs/ui/src/renderer/flow/index.ts'),
      '@frontmcp/ui/renderer/math': resolve(root, 'libs/ui/src/renderer/math/index.ts'),
      '@frontmcp/ui/renderer/maps': resolve(root, 'libs/ui/src/renderer/maps/index.ts'),
      '@frontmcp/ui/renderer/image': resolve(root, 'libs/ui/src/renderer/image/index.ts'),
      '@frontmcp/ui/renderer/media': resolve(root, 'libs/ui/src/renderer/media/index.ts'),
      '@frontmcp/ui/theme': resolve(root, 'libs/ui/src/theme/index.ts'),
      '@frontmcp/ui/components': resolve(root, 'libs/ui/src/components/index.ts'),
      '@frontmcp/ui/react': resolve(root, 'libs/ui/src/react/index.ts'),
      '@frontmcp/ui/bridge': resolve(root, 'libs/ui/src/bridge/index.ts'),
      '@frontmcp/ui': resolve(root, 'libs/ui/src/index.ts'),
    },
  },
  optimizeDeps: {
    include: [
      'recharts',
      'mermaid',
      '@xyflow/react',
      'katex',
      'react-leaflet',
      'leaflet',
      'react-player',
      'react-pdf',
      'pdfjs-dist',
      'dompurify',
      'react-markdown',
      'remark-gfm',
      'rehype-highlight',
      'rehype-raw',
    ],
  },
  server: {
    port: 4400,
  },
  build: {
    outDir: resolve(root, 'dist/apps/e2e/demo-e2e-renderer-showcase'),
    emptyOutDir: true,
  },
});
