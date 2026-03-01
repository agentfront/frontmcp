export type { ContentRenderer, RenderOptions, ContentType } from './types';
export {
  detectContentType,
  renderContent,
  registerRenderer,
  getRenderer,
  getRegisteredRenderers,
  ContentView,
  type ContentViewProps,
  type DetectedContentType,
} from './auto-detect';

// Common utilities
export { useRendererTheme, extractThemeValues, type RendererThemeValues } from './common';
export { injectStylesheet } from './common';
export {
  createLazyImport,
  runtimeImportWithFallback,
  esmShUrl,
  ESM_SH_BASE,
  type LazyImport,
  type LazyImportState,
} from './common';
export { useLazyModule } from './common';

// Existing renderers
export { MdxRenderer, mdxRenderer } from './mdx';
export { HtmlRenderer, htmlRenderer } from './html';
export { ReactJsxRenderer, reactJsxRenderer } from './react';
export { PdfRenderer, pdfRenderer } from './pdf';
export { CsvRenderer, csvRenderer } from './csv';

// New renderers
export { ImageRenderer, imageRenderer } from './image';
export { ChartsRenderer, chartsRenderer } from './charts';
export { MermaidRenderer, mermaidRenderer } from './mermaid';
export { FlowRenderer, flowRenderer } from './flow';
export { MathRenderer, mathRenderer } from './math';
export { MapsRenderer, mapsRenderer } from './maps';
export { VideoRenderer, AudioRenderer, videoRenderer, audioRenderer } from './media';

// Detection helpers
export { isImage } from './image';
export { isChart } from './charts';
export { isMermaid } from './mermaid';
export { isFlow } from './flow';
export { isMath } from './math';
export { isMap } from './maps';
export { isVideo, isAudio, isMedia } from './media';
export { isReactJsx } from './react';

// Convenience: register all renderers
import { registerRenderer } from './auto-detect';
import { mdxRenderer } from './mdx';
import { htmlRenderer } from './html';
import { reactJsxRenderer } from './react';
import { pdfRenderer } from './pdf';
import { csvRenderer } from './csv';
import { imageRenderer } from './image';
import { chartsRenderer } from './charts';
import { mermaidRenderer } from './mermaid';
import { flowRenderer } from './flow';
import { mathRenderer } from './math';
import { mapsRenderer } from './maps';
import { videoRenderer, audioRenderer } from './media';

/**
 * Register all built-in renderers with the auto-detect registry.
 * Call this once at app startup if you want all renderers available.
 */
export function registerAllRenderers(): void {
  const all = [
    pdfRenderer,
    chartsRenderer,
    flowRenderer,
    mapsRenderer,
    mermaidRenderer,
    mathRenderer,
    imageRenderer,
    videoRenderer,
    audioRenderer,
    csvRenderer,
    reactJsxRenderer,
    mdxRenderer,
    htmlRenderer,
  ];

  for (const renderer of all) {
    registerRenderer(renderer);
  }
}
