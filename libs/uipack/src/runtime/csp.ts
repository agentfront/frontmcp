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
export const DEFAULT_CDN_DOMAINS = [
  'https://cdn.jsdelivr.net', // Tailwind, Alpine, React, icons
  'https://cdnjs.cloudflare.com', // HTMX, other libraries
  'https://fonts.googleapis.com', // Google Fonts stylesheets
  'https://fonts.gstatic.com', // Google Fonts files
] as const;

/**
 * Default CSP when no custom policy is provided.
 * Includes CDN domains required for standard FrontMCP templates.
 */
export const DEFAULT_CSP_DIRECTIVES = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-inline' ${DEFAULT_CDN_DOMAINS.join(' ')}`,
  `style-src 'self' 'unsafe-inline' ${DEFAULT_CDN_DOMAINS.join(' ')}`,
  `img-src 'self' data: ${DEFAULT_CDN_DOMAINS.join(' ')}`,
  `font-src 'self' data: ${DEFAULT_CDN_DOMAINS.join(' ')}`,
  "connect-src 'none'",
] as const;

/**
 * Restrictive CSP for sandboxed environments with no external resources.
 * Use this when you want to block all external resources.
 */
export const RESTRICTIVE_CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
] as const;

/**
 * Build CSP directives from a UIContentSecurityPolicy configuration
 */
export function buildCSPDirectives(csp?: UIContentSecurityPolicy): string[] {
  if (!csp) {
    return [...DEFAULT_CSP_DIRECTIVES];
  }

  // Validate and sanitize domains before use
  const validResourceDomains = sanitizeCSPDomains(csp.resourceDomains);
  const validConnectDomains = sanitizeCSPDomains(csp.connectDomains);

  // Combine user-specified domains with default CDN domains
  // This ensures templates can always load Tailwind, fonts, etc.
  const allResourceDomains = [...new Set([...DEFAULT_CDN_DOMAINS, ...validResourceDomains])];

  const directives: string[] = [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${allResourceDomains.join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${allResourceDomains.join(' ')}`,
  ];

  // Image sources
  const imgSources = ["'self'", 'data:', ...allResourceDomains];
  directives.push(`img-src ${imgSources.join(' ')}`);

  // Font sources
  const fontSources = ["'self'", 'data:', ...allResourceDomains];
  directives.push(`font-src ${fontSources.join(' ')}`);

  // Connect sources (for fetch/XHR/WebSocket)
  if (validConnectDomains.length) {
    directives.push(`connect-src ${validConnectDomains.join(' ')}`);
  } else {
    directives.push("connect-src 'none'");
  }

  return directives;
}

/**
 * Build a CSP meta tag from directives
 */
export function buildCSPMetaTag(csp?: UIContentSecurityPolicy): string {
  const directives = buildCSPDirectives(csp);
  const content = directives.join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(content)}">`;
}

/**
 * Build CSP for OpenAI Apps SDK format
 * Returns the object format expected by _meta['openai/widgetCSP']
 */
export function buildOpenAICSP(csp?: UIContentSecurityPolicy):
  | {
      connect_domains?: string[];
      resource_domains?: string[];
    }
  | undefined {
  if (!csp) return undefined;

  const result: {
    connect_domains?: string[];
    resource_domains?: string[];
  } = {};

  if (csp.connectDomains?.length) {
    result.connect_domains = csp.connectDomains;
  }

  if (csp.resourceDomains?.length) {
    result.resource_domains = csp.resourceDomains;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Escape a string for use in an HTML attribute
 */
function escapeAttribute(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Validate CSP domain format
 * Domains should be valid URLs or wildcard patterns
 */
export function validateCSPDomain(domain: string): boolean {
  // Allow wildcard subdomains (e.g., https://*.example.com, https://*.x.io)
  if (domain.startsWith('https://*.')) {
    const rest = domain.slice(10);
    // Allow single-char segments and multi-level domains
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(rest);
  }

  // Standard HTTPS URL
  try {
    const url = new URL(domain);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Filter and warn about invalid CSP domains
 */
export function sanitizeCSPDomains(domains: string[] | undefined): string[] {
  if (!domains) return [];

  const valid: string[] = [];
  for (const domain of domains) {
    if (validateCSPDomain(domain)) {
      valid.push(domain);
    } else {
      console.warn(`Invalid CSP domain ignored: ${domain}`);
    }
  }

  return valid;
}
