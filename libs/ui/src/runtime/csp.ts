/**
 * Content Security Policy Builder
 *
 * Generates CSP meta tags for sandboxed UI templates based on
 * OpenAI Apps SDK and ext-apps (SEP-1865) specifications.
 */

import type { UIContentSecurityPolicy } from './types';

/**
 * Default CSP when no custom policy is provided.
 * Very restrictive - no external resources allowed.
 */
export const DEFAULT_CSP_DIRECTIVES = [
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

  const directives: string[] = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
  ];

  // Image sources
  const imgSources = ["'self'", 'data:'];
  if (csp.resourceDomains?.length) {
    imgSources.push(...csp.resourceDomains);
  }
  directives.push(`img-src ${imgSources.join(' ')}`);

  // Font sources
  const fontSources = ["'self'", 'data:'];
  if (csp.resourceDomains?.length) {
    fontSources.push(...csp.resourceDomains);
  }
  directives.push(`font-src ${fontSources.join(' ')}`);

  // Connect sources (for fetch/XHR/WebSocket)
  if (csp.connectDomains?.length) {
    directives.push(`connect-src ${csp.connectDomains.join(' ')}`);
  } else {
    directives.push("connect-src 'none'");
  }

  // Script sources (add resource domains if specified)
  if (csp.resourceDomains?.length) {
    directives[1] = `script-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(' ')}`;
    directives[2] = `style-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(' ')}`;
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
  // Allow wildcard subdomains
  if (domain.startsWith('https://*.')) {
    const rest = domain.slice(10);
    return /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(rest);
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
