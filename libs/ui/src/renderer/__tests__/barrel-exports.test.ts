/**
 * Barrel Export Tests
 *
 * Verify that all renderers, types, and utilities are properly exported
 * from the renderer/index.ts barrel.
 */

import * as Renderer from '../index';

describe('Renderer barrel exports', () => {
  // Types
  it('should export ContentView component', () => {
    expect(Renderer.ContentView).toBeDefined();
  });

  // Registry functions
  it('should export registry functions', () => {
    expect(typeof Renderer.detectContentType).toBe('function');
    expect(typeof Renderer.renderContent).toBe('function');
    expect(typeof Renderer.registerRenderer).toBe('function');
    expect(typeof Renderer.getRenderer).toBe('function');
    expect(typeof Renderer.getRegisteredRenderers).toBe('function');
    expect(typeof Renderer.registerAllRenderers).toBe('function');
  });

  // Common utilities
  it('should export common utilities', () => {
    expect(typeof Renderer.useRendererTheme).toBe('function');
    expect(typeof Renderer.extractThemeValues).toBe('function');
    expect(typeof Renderer.injectStylesheet).toBe('function');
    expect(typeof Renderer.createLazyImport).toBe('function');
  });

  // Existing renderers
  it('should export existing renderer classes', () => {
    expect(Renderer.MdxRenderer).toBeDefined();
    expect(Renderer.HtmlRenderer).toBeDefined();
    expect(Renderer.ReactJsxRenderer).toBeDefined();
    expect(Renderer.PdfRenderer).toBeDefined();
    expect(Renderer.CsvRenderer).toBeDefined();
  });

  it('should export existing renderer instances', () => {
    expect(Renderer.mdxRenderer).toBeInstanceOf(Renderer.MdxRenderer);
    expect(Renderer.htmlRenderer).toBeInstanceOf(Renderer.HtmlRenderer);
    expect(Renderer.reactJsxRenderer).toBeInstanceOf(Renderer.ReactJsxRenderer);
    expect(Renderer.pdfRenderer).toBeInstanceOf(Renderer.PdfRenderer);
    expect(Renderer.csvRenderer).toBeInstanceOf(Renderer.CsvRenderer);
  });

  // New renderers
  it('should export new renderer classes', () => {
    expect(Renderer.ImageRenderer).toBeDefined();
    expect(Renderer.ChartsRenderer).toBeDefined();
    expect(Renderer.MermaidRenderer).toBeDefined();
    expect(Renderer.FlowRenderer).toBeDefined();
    expect(Renderer.MathRenderer).toBeDefined();
    expect(Renderer.MapsRenderer).toBeDefined();
    expect(Renderer.VideoRenderer).toBeDefined();
    expect(Renderer.AudioRenderer).toBeDefined();
  });

  it('should export new renderer instances', () => {
    expect(Renderer.imageRenderer).toBeInstanceOf(Renderer.ImageRenderer);
    expect(Renderer.chartsRenderer).toBeInstanceOf(Renderer.ChartsRenderer);
    expect(Renderer.mermaidRenderer).toBeInstanceOf(Renderer.MermaidRenderer);
    expect(Renderer.flowRenderer).toBeInstanceOf(Renderer.FlowRenderer);
    expect(Renderer.mathRenderer).toBeInstanceOf(Renderer.MathRenderer);
    expect(Renderer.mapsRenderer).toBeInstanceOf(Renderer.MapsRenderer);
    expect(Renderer.videoRenderer).toBeInstanceOf(Renderer.VideoRenderer);
    expect(Renderer.audioRenderer).toBeInstanceOf(Renderer.AudioRenderer);
  });

  // Detection helpers
  it('should export detection helpers', () => {
    expect(typeof Renderer.isImage).toBe('function');
    expect(typeof Renderer.isChart).toBe('function');
    expect(typeof Renderer.isMermaid).toBe('function');
    expect(typeof Renderer.isFlow).toBe('function');
    expect(typeof Renderer.isMath).toBe('function');
    expect(typeof Renderer.isMap).toBe('function');
    expect(typeof Renderer.isVideo).toBe('function');
    expect(typeof Renderer.isAudio).toBe('function');
    expect(typeof Renderer.isMedia).toBe('function');
  });

  // registerAllRenderers
  it('should register all renderers without error', () => {
    expect(() => Renderer.registerAllRenderers()).not.toThrow();
  });

  it('should have renderers in registry after registerAllRenderers', () => {
    Renderer.registerAllRenderers();
    const renderers = Renderer.getRegisteredRenderers();
    expect(renderers.length).toBeGreaterThanOrEqual(13); // All built-in renderers
  });
});
