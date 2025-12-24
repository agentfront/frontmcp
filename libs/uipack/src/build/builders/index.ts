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

// esbuild configuration utilities
export {
  DEFAULT_EXTERNALS,
  EXTERNAL_GLOBALS,
  CDN_URLS,
  CLOUDFLARE_CDN_URLS,
  createTransformConfig,
  createExternalizedConfig,
  createInlineConfig,
  createExternalsBanner,
  generateCdnScriptTags,
  generateGlobalsSetupScript,
} from './esbuild-config';
