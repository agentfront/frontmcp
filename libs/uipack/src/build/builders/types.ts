/**
 * Builder Types
 *
 * Type definitions for the Static, Hybrid, and Inline builders.
 * These builders create universal HTML documents for MCP clients.
 *
 * @packageDocumentation
 */

import type { UITemplateConfig } from '../../types';
import type { ThemeConfig, DeepPartial } from '../../theme';

// ============================================
// Build Mode
// ============================================

/**
 * Build mode for widget generation.
 *
 * - `'static'`: Full HTML with placeholders. Data injected at preview time.
 *   Best for production - widget is cached, only data changes per request.
 *
 * - `'hybrid'`: Vendor shell (cached) + component chunks (per-tool).
 *   Shell delivered via resource URI, component via tool response.
 *   Optimal for OpenAI where shell is fetched once and cached.
 *
 * - `'inline'`: Minimal loader at discovery, full HTML per request.
 *   Best for development/review. Each request gets complete widget.
 */
export type BuildMode = 'static' | 'hybrid' | 'inline';

/**
 * CDN loading mode for dependencies.
 *
 * - `'cdn'`: Load React/deps from CDN (smaller HTML, requires network)
 * - `'inline'`: Bundle all deps inline (larger HTML, works offline)
 */
export type CdnMode = 'cdn' | 'inline';

// ============================================
// Builder Options
// ============================================

/**
 * Common options for all builders.
 */
export interface BuilderOptions {
  /**
   * CDN loading mode for dependencies.
   * @default 'cdn'
   */
  cdnMode?: CdnMode;

  /**
   * Whether to minify the output HTML.
   * @default false
   */
  minify?: boolean;

  /**
   * Theme configuration override.
   */
  theme?: DeepPartial<ThemeConfig>;

  /**
   * Whether to include source maps.
   * @default false
   */
  sourceMaps?: boolean;
}

/**
 * Options for building a specific tool's UI.
 */
export interface BuildToolOptions<In = unknown, Out = unknown> {
  /**
   * UI template configuration.
   */
  template: UITemplateConfig<In, Out>;

  /**
   * Name of the tool this UI is for.
   */
  toolName: string;

  /**
   * Optional title for the HTML document.
   */
  title?: string;

  /**
   * Sample input for preview/development.
   */
  sampleInput?: In;

  /**
   * Sample output for preview/development.
   */
  sampleOutput?: Out;
}

// ============================================
// Build Results
// ============================================

/**
 * Result from a static build.
 *
 * Static builds produce a complete HTML document with placeholders
 * that are replaced with actual data at preview time.
 */
export interface StaticBuildResult {
  /**
   * Build mode identifier.
   */
  mode: 'static';

  /**
   * Complete HTML document with placeholders.
   */
  html: string;

  /**
   * Content hash for caching.
   */
  hash: string;

  /**
   * Size in bytes.
   */
  size: number;

  /**
   * Estimated gzipped size in bytes.
   */
  gzipSize: number;

  /**
   * Placeholders present in the HTML.
   */
  placeholders: {
    hasOutput: boolean;
    hasInput: boolean;
  };

  /**
   * Renderer type used (html, react, mdx).
   */
  rendererType: string;

  /**
   * Build timestamp (ISO 8601).
   */
  buildTime: string;
}

/**
 * Result from a hybrid build.
 *
 * Hybrid builds produce a vendor shell (cached, shared across tools)
 * and component chunks (per-tool, externalized dependencies).
 */
export interface HybridBuildResult {
  /**
   * Build mode identifier.
   */
  mode: 'hybrid';

  /**
   * Vendor shell HTML (shared across all tools).
   * Contains React, Bridge, UI components from CDN.
   */
  vendorShell: string;

  /**
   * Transpiled component code (externalized).
   * Imports React/deps from shell's globals.
   */
  componentChunk: string;

  /**
   * Resource URI for the vendor shell.
   * Used in _meta['openai/outputTemplate'].
   */
  shellResourceUri: string;

  /**
   * Content hash for caching.
   */
  hash: string;

  /**
   * Size of vendor shell in bytes.
   */
  shellSize: number;

  /**
   * Size of component chunk in bytes.
   */
  componentSize: number;

  /**
   * Renderer type used (html, react, mdx).
   */
  rendererType: string;

  /**
   * Build timestamp (ISO 8601).
   */
  buildTime: string;
}

/**
 * Result from an inline build.
 *
 * Inline builds produce a minimal loader shell (for discovery)
 * and full widget HTML (for each tool execution).
 */
export interface InlineBuildResult {
  /**
   * Build mode identifier.
   */
  mode: 'inline';

  /**
   * Minimal loader HTML (returned at tools/list).
   * Contains bridge + loading indicator + injector script.
   */
  loaderShell: string;

  /**
   * Full widget HTML generator.
   * Called with input/output to produce complete HTML.
   */
  buildFullWidget: (input: unknown, output: unknown) => Promise<string>;

  /**
   * Content hash for the loader.
   */
  hash: string;

  /**
   * Size of loader in bytes.
   */
  loaderSize: number;

  /**
   * Renderer type used (html, react, mdx).
   */
  rendererType: string;

  /**
   * Build timestamp (ISO 8601).
   */
  buildTime: string;
}

/**
 * Union type for all build results.
 * Named BuilderResult to avoid conflict with the existing BuildResult type in build/index.ts.
 */
export type BuilderResult = StaticBuildResult | HybridBuildResult | InlineBuildResult;

// ============================================
// Builder Interfaces
// ============================================

/**
 * Interface for all builders.
 */
export interface Builder<TResult extends BuilderResult> {
  /**
   * Build mode this builder produces.
   */
  readonly mode: BuildMode;

  /**
   * Build a tool UI.
   */
  build<In = unknown, Out = unknown>(
    options: BuildToolOptions<In, Out>
  ): Promise<TResult>;
}

/**
 * Interface for the static builder.
 */
export interface IStaticBuilder extends Builder<StaticBuildResult> {
  readonly mode: 'static';

  /**
   * Inject data into a pre-built shell.
   */
  injectData(
    shell: string,
    input: unknown,
    output: unknown
  ): string;
}

/**
 * Interface for the hybrid builder.
 */
export interface IHybridBuilder extends Builder<HybridBuildResult> {
  readonly mode: 'hybrid';

  /**
   * Build just the vendor shell (cached, shared).
   */
  buildVendorShell(): Promise<string>;

  /**
   * Build a component chunk for a specific template.
   */
  buildComponentChunk<In = unknown, Out = unknown>(
    template: UITemplateConfig<In, Out>['template']
  ): Promise<string>;

  /**
   * Combine shell and component for Claude/inline delivery.
   */
  combineForInline(
    shell: string,
    component: string,
    input: unknown,
    output: unknown
  ): string;
}

/**
 * Interface for the inline builder.
 */
export interface IInlineBuilder extends Builder<InlineBuildResult> {
  readonly mode: 'inline';

  /**
   * Build the minimal loader shell.
   */
  buildLoader(toolName: string): string;

  /**
   * Build full widget HTML with embedded data.
   */
  buildFullWidget<In = unknown, Out = unknown>(
    template: UITemplateConfig<In, Out>['template'],
    input: In,
    output: Out
  ): Promise<string>;
}

// ============================================
// Template Detection
// ============================================

/**
 * Detected template type.
 */
export type TemplateType = 'html-string' | 'html-function' | 'react-component' | 'react-element' | 'mdx';

/**
 * Template detection result.
 */
export interface TemplateDetection {
  /**
   * Detected template type.
   */
  type: TemplateType;

  /**
   * Renderer to use for this template.
   */
  renderer: 'html' | 'react' | 'mdx';

  /**
   * Whether the template needs transpilation.
   */
  needsTranspilation: boolean;
}

// ============================================
// Transpilation Options
// ============================================

/**
 * Options for transpiling component code.
 */
export interface TranspileOptions {
  /**
   * External dependencies to exclude from bundle.
   * These will be loaded from the shell's globals.
   */
  externals?: string[];

  /**
   * Output format.
   * @default 'esm'
   */
  format?: 'esm' | 'iife';

  /**
   * Target ES version.
   * @default 'es2020'
   */
  target?: string;

  /**
   * Whether to minify output.
   * @default false
   */
  minify?: boolean;

  /**
   * JSX import source.
   * @default 'react'
   */
  jsxImportSource?: string;
}

/**
 * Result of transpilation.
 */
export interface TranspileResult {
  /**
   * Transpiled JavaScript code.
   */
  code: string;

  /**
   * Source map (if requested).
   */
  map?: string;

  /**
   * Size in bytes.
   */
  size: number;

  /**
   * Detected imports that were externalized.
   */
  externalizedImports: string[];
}
