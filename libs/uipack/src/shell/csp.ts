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
  'https://esm.sh',
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
  `connect-src ${DEFAULT_CDN_DOMAINS.join(' ')}`,
  "object-src 'self' data:",
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
  "object-src 'self' data:",
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

  // Declared connect origins are added to what the page may already reach (the CDNs and the
  // resource origins), never in their place
  const connectSources = [...new Set([...allResourceDomains, ...validConnectDomains])];
  directives.push(`connect-src ${connectSources.join(' ')}`);

  directives.push("object-src 'self' data:");

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

/** Hosts a page may reach over plain `http:` / `ws:` (local development). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validate CSP domain format.
 *
 * Accepts `https://` and `wss://` origins (a WebSocket API needs `wss://` in `connect-src`),
 * their `https://*.` / `wss://*.` wildcard forms, and `http://` / `ws://` origins on a loopback
 * host (`localhost`, `127.0.0.1`, `[::1]`) for local development.
 */
export function validateCSPDomain(domain: string): boolean {
  // One source token: whitespace, `;` or `,` would end it and start another source or directive
  if (typeof domain !== 'string' || /[\s;,'"]/.test(domain)) return false;

  if (domain.includes('*')) {
    const wildcard = /^(?:https|wss):\/\/\*\.(.*)$/.exec(domain);
    return wildcard !== null && /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(wildcard[1]);
  }

  try {
    const url = new URL(domain);
    if (url.protocol === 'https:' || url.protocol === 'wss:') return true;
    return (url.protocol === 'http:' || url.protocol === 'ws:') && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Invalid domains already reported, so a widget rendered on every call warns once per domain. */
const reportedInvalidDomains = new Set<string>();

/**
 * Filter out invalid CSP domains, warning once per domain.
 */
export function sanitizeCSPDomains(domains: string[] | undefined): string[] {
  if (!domains) return [];

  const valid: string[] = [];
  for (const domain of domains) {
    if (validateCSPDomain(domain)) {
      valid.push(domain);
    } else if (!reportedInvalidDomains.has(domain)) {
      reportedInvalidDomains.add(domain);
      console.warn(
        `Invalid CSP domain ignored: ${domain} (expected an https:// or wss:// origin, or http:// / ws:// on localhost)`,
      );
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
