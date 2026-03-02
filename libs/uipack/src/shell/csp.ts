/**
 * Content Security Policy Builder
 *
 * Generates CSP meta tags for sandboxed UI templates.
 *
 * @packageDocumentation
 */

import type { CSPConfig } from './types';

/**
 * Default CDN domains used by FrontMCP UI templates.
 */
export const DEFAULT_CDN_DOMAINS = [
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
] as const;

/**
 * Default CSP when no custom policy is provided.
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
 * Build CSP directives from a CSPConfig configuration.
 */
export function buildCSPDirectives(csp?: CSPConfig): string[] {
  if (!csp) {
    return [...DEFAULT_CSP_DIRECTIVES];
  }

  const validResourceDomains = sanitizeCSPDomains(csp.resourceDomains);
  const validConnectDomains = sanitizeCSPDomains(csp.connectDomains);

  const allResourceDomains = [...new Set([...DEFAULT_CDN_DOMAINS, ...validResourceDomains])];

  const directives: string[] = [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${allResourceDomains.join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${allResourceDomains.join(' ')}`,
  ];

  const imgSources = ["'self'", 'data:', ...allResourceDomains];
  directives.push(`img-src ${imgSources.join(' ')}`);

  const fontSources = ["'self'", 'data:', ...allResourceDomains];
  directives.push(`font-src ${fontSources.join(' ')}`);

  if (validConnectDomains.length) {
    directives.push(`connect-src ${validConnectDomains.join(' ')}`);
  } else {
    directives.push("connect-src 'none'");
  }

  return directives;
}

/**
 * Build a CSP meta tag from config.
 */
export function buildCSPMetaTag(csp?: CSPConfig): string {
  const directives = buildCSPDirectives(csp);
  const content = directives.join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(content)}">`;
}

/**
 * Validate CSP domain format.
 */
export function validateCSPDomain(domain: string): boolean {
  if (domain.startsWith('https://*.')) {
    const rest = domain.slice(10);
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(rest);
  }

  try {
    const url = new URL(domain);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Filter and warn about invalid CSP domains.
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

function escapeAttribute(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
