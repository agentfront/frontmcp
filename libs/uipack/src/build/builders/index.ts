/**
 * UI Builders
 *
 * Three build modes for creating universal HTML documents:
 * - Static: Full HTML with placeholders, inject data at preview time
 * - Hybrid: Vendor shell + component chunks, optimal for OpenAI
 * - Inline: Minimal loader + full HTML per request, best for development
 *
 * @packageDocumentation
 */

// Types
export type {
  BuildMode,
  CdnMode,
  BuilderOptions,
  BuildToolOptions,
  StaticBuildResult,
  HybridBuildResult,
  InlineBuildResult,
  BuilderResult,
  Builder,
  IStaticBuilder,
  IHybridBuilder,
  IInlineBuilder,
  TemplateType,
  TemplateDetection,
  TranspileOptions,
  TranspileResult,
} from './types';

// Builders
export { BaseBuilder } from './base-builder';
export { StaticBuilder } from './static-builder';
export { HybridBuilder } from './hybrid-builder';
export { InlineBuilder } from './inline-builder';

// CDN configuration (shared constants, no esbuild dependency)
export {
  DEFAULT_EXTERNALS,
  EXTERNAL_GLOBALS,
  CDN_URLS,
  CLOUDFLARE_CDN_URLS,
  BABEL_STANDALONE_CDN,
  FRONTMCP_UI_CDN,
  createExternalsBanner,
  generateCdnScriptTags,
  generateGlobalsSetupScript,
} from './cdn-config';

// esbuild configuration utilities (requires esbuild)
export {
  createTransformConfig,
  createExternalizedConfig,
  createInlineConfig,
} from './esbuild-config';
