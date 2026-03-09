/**
 * Platform Adapters
 *
 * Stub module — platform adapter functions were removed from @frontmcp/uipack.
 * These will be re-implemented against the new shell/resolver API.
 *
 * TODO: Re-implement against new @frontmcp/uipack API after redesign
 */

// Stub types
export type AIPlatformType = 'openai' | 'claude' | 'gemini' | 'cursor' | 'continue' | 'cody' | 'unknown';

export interface UIMetadata {
  [key: string]: unknown;
}

export interface BuildUIMetaOptions {
  toolName: string;
  html?: string;
  platform?: AIPlatformType;
  [key: string]: unknown;
}

export interface BuildToolDiscoveryMetaOptions {
  toolName: string;
  platform?: AIPlatformType;
  [key: string]: unknown;
}

export function buildUIMeta(_options: BuildUIMetaOptions): UIMetadata {
  return {};
}

export function buildToolDiscoveryMeta(_options: BuildToolDiscoveryMetaOptions): UIMetadata {
  return {};
}

export function buildOpenAICSP(_csp?: {
  connectDomains?: string[];
  resourceDomains?: string[];
}): { connect_domains?: string[]; resource_domains?: string[] } | undefined {
  return undefined;
}
