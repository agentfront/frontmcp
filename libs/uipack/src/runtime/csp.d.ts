/**
 * Content Security Policy Builder
 *
 * Generates CSP meta tags for sandboxed UI templates based on
 * OpenAI Apps SDK and ext-apps (SEP-1865) specifications.
 */
import type { UIContentSecurityPolicy } from './types';
/**
 * Default CDN domains used by FrontMCP UI templates.
 * These are required for Tailwind, Google Fonts, and other external resources.
 */
export declare const DEFAULT_CDN_DOMAINS: readonly [
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];
/**
 * Default CSP when no custom policy is provided.
 * Includes CDN domains required for standard FrontMCP templates.
 */
export declare const DEFAULT_CSP_DIRECTIVES: readonly [
  "default-src 'none'",
  `script-src 'self' 'unsafe-inline' ${string}`,
  `style-src 'self' 'unsafe-inline' ${string}`,
  `img-src 'self' data: ${string}`,
  `font-src 'self' data: ${string}`,
  "connect-src 'none'",
];
/**
 * Restrictive CSP for sandboxed environments with no external resources.
 * Use this when you want to block all external resources.
 */
export declare const RESTRICTIVE_CSP_DIRECTIVES: readonly [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
];
/**
 * Build CSP directives from a UIContentSecurityPolicy configuration
 */
export declare function buildCSPDirectives(csp?: UIContentSecurityPolicy): string[];
/**
 * Build a CSP meta tag from directives
 */
export declare function buildCSPMetaTag(csp?: UIContentSecurityPolicy): string;
/**
 * Build CSP for OpenAI Apps SDK format
 * Returns the object format expected by _meta['openai/widgetCSP']
 */
export declare function buildOpenAICSP(csp?: UIContentSecurityPolicy):
  | {
      connect_domains?: string[];
      resource_domains?: string[];
    }
  | undefined;
/**
 * Validate CSP domain format
 * Domains should be valid URLs or wildcard patterns
 */
export declare function validateCSPDomain(domain: string): boolean;
/**
 * Filter and warn about invalid CSP domains
 */
export declare function sanitizeCSPDomains(domains: string[] | undefined): string[];
//# sourceMappingURL=csp.d.ts.map
