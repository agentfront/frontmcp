import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');

const RENDERER_DEPS = [
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
];

/**
 * Vite plugin that transforms `runtimeImport` in lazy-import.ts to use
 * static `import()` calls for known renderer dependencies.
 *
 * This is necessary because `new Function('s', 'return import(s)')` creates
 * native browser `import()` calls that bypass Vite's transform pipeline.
 * Browsers cannot resolve bare specifiers (like `'recharts'`) natively.
 */
function rendererDepsPlugin(): Plugin {
  return {
    name: 'renderer-deps-resolver',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('lazy-import')) return;

      // Regex matches the runtimeImport function — tolerant of whitespace/formatting
      const fnRegex =
        /export\s+function\s+runtimeImport\(\s*specifier\s*:\s*string\s*\)\s*:\s*Promise<Record<string,\s*unknown>>\s*\{[^}]*new\s+Function\([^)]*\)[^}]*\}/;

      if (!fnRegex.test(code)) {
        console.warn('[renderer-deps-resolver] ⚠ Could not match runtimeImport in', id);
        return;
      }

      const cases = RENDERER_DEPS.map(
        (dep) => `    case ${JSON.stringify(dep)}: return import(${JSON.stringify(dep)});`,
      ).join('\n');

      const replacement = [
        'export function runtimeImport(specifier: string): Promise<Record<string, unknown>> {',
        '  switch (specifier) {',
        cases,
        '    default: {',
        '      // eslint-disable-next-line @typescript-eslint/no-implied-eval',
        "      const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<Record<string, unknown>>;",
        '      return dynamicImport(specifier);',
        '    }',
        '  }',
        '}',
      ].join('\n');

      console.log('[renderer-deps-resolver] ✓ Transformed runtimeImport in', id.split('/').slice(-3).join('/'));
      return code.replace(fnRegex, replacement);
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [rendererDepsPlugin(), react()],
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
