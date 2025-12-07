/**
 * @file csp.ts
 * @description Content Security Policy generation for MCP Apps.
 *
 * Generates CSP headers per the MCP Apps specification for iframe sandboxing.
 *
 * @module @frontmcp/sdk/mcp-apps/csp
 */

import type { McpAppsCSP } from './types';

// ============================================
// CSP Directive Types
// ============================================

/**
 * Individual CSP directive.
 */
export interface CSPDirective {
  name: string;
  values: string[];
}

/**
 * Complete CSP configuration.
 */
export interface CSPConfig {
  directives: CSPDirective[];
}

// ============================================
// Default CSP Values
// ============================================

/**
 * Default CSP directives per MCP Apps spec.
 * These are the baseline security restrictions.
 */
export const DEFAULT_CSP_DIRECTIVES: CSPDirective[] = [
  { name: 'default-src', values: ["'none'"] },
  { name: 'script-src', values: ["'self'", "'unsafe-inline'"] },
  { name: 'style-src', values: ["'self'", "'unsafe-inline'"] },
  { name: 'img-src', values: ["'self'", 'data:'] },
  { name: 'font-src', values: ["'self'"] },
  { name: 'connect-src', values: ["'none'"] },
  { name: 'frame-src', values: ["'none'"] },
  { name: 'object-src', values: ["'none'"] },
  { name: 'base-uri', values: ["'self'"] },
  { name: 'form-action', values: ["'self'"] },
];

/**
 * Sandbox attribute values for iframe.
 * Minimum required permissions per MCP Apps spec.
 */
export const SANDBOX_PERMISSIONS = ['allow-scripts', 'allow-same-origin'] as const;

/**
 * Extended sandbox permissions that may be granted.
 */
export const EXTENDED_SANDBOX_PERMISSIONS = [
  ...SANDBOX_PERMISSIONS,
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
] as const;

// ============================================
// CSP Generation Functions
// ============================================

/**
 * Build CSP header string from MCP Apps CSP configuration.
 *
 * @param csp - MCP Apps CSP configuration
 * @returns CSP header string
 *
 * @example
 * ```typescript
 * const csp = buildCSPHeader({
 *   connectDomains: ['https://api.example.com'],
 *   resourceDomains: ['https://cdn.example.com'],
 * });
 * // Returns: "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.example.com; ..."
 * ```
 */
export function buildCSPHeader(csp?: McpAppsCSP): string {
  const directives = buildCSPDirectives(csp);
  return directives.map((d) => `${d.name} ${d.values.join(' ')}`).join('; ');
}

/**
 * Build CSP directives array from MCP Apps CSP configuration.
 *
 * @param csp - MCP Apps CSP configuration
 * @returns Array of CSP directives
 */
export function buildCSPDirectives(csp?: McpAppsCSP): CSPDirective[] {
  // Start with defaults
  const directives = new Map<string, string[]>();

  for (const directive of DEFAULT_CSP_DIRECTIVES) {
    directives.set(directive.name, [...directive.values]);
  }

  if (csp) {
    // Add connect domains
    if (csp.connectDomains && csp.connectDomains.length > 0) {
      const connectSrc = directives.get('connect-src') || [];
      // Replace 'none' with actual domains
      const filteredConnect = connectSrc.filter((v) => v !== "'none'");
      directives.set('connect-src', [...filteredConnect, "'self'", ...csp.connectDomains]);
    }

    // Add resource domains to appropriate directives
    if (csp.resourceDomains && csp.resourceDomains.length > 0) {
      const resourceDomains = csp.resourceDomains;

      // script-src
      const scriptSrc = directives.get('script-src') || [];
      directives.set('script-src', [...scriptSrc, ...resourceDomains]);

      // style-src
      const styleSrc = directives.get('style-src') || [];
      directives.set('style-src', [...styleSrc, ...resourceDomains]);

      // img-src
      const imgSrc = directives.get('img-src') || [];
      directives.set('img-src', [...imgSrc, ...resourceDomains]);

      // font-src
      const fontSrc = directives.get('font-src') || [];
      directives.set('font-src', [...fontSrc, ...resourceDomains]);
    }
  }

  // Convert map to array
  return Array.from(directives.entries()).map(([name, values]) => ({
    name,
    values: [...new Set(values)], // Deduplicate
  }));
}

/**
 * Build sandbox attribute value for iframe.
 *
 * @param options - Sandbox options
 * @returns Sandbox attribute value string
 *
 * @example
 * ```typescript
 * const sandbox = buildSandboxAttribute({ allowForms: true });
 * // Returns: "allow-scripts allow-same-origin allow-forms"
 * ```
 */
export function buildSandboxAttribute(options?: {
  allowForms?: boolean;
  allowPopups?: boolean;
  allowPopupsToEscapeSandbox?: boolean;
}): string {
  const permissions: string[] = [...SANDBOX_PERMISSIONS];

  if (options?.allowForms) {
    permissions.push('allow-forms');
  }

  if (options?.allowPopups) {
    permissions.push('allow-popups');
  }

  if (options?.allowPopupsToEscapeSandbox) {
    permissions.push('allow-popups-to-escape-sandbox');
  }

  return permissions.join(' ');
}

/**
 * Build CSP meta tag for embedding in HTML.
 *
 * @param csp - MCP Apps CSP configuration
 * @returns HTML meta tag string
 *
 * @example
 * ```typescript
 * const meta = buildCSPMetaTag({ connectDomains: ['https://api.example.com'] });
 * // Returns: <meta http-equiv="Content-Security-Policy" content="...">
 * ```
 */
export function buildCSPMetaTag(csp?: McpAppsCSP): string {
  const header = buildCSPHeader(csp);
  return `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(header)}">`;
}

/**
 * Validate domain against CSP configuration.
 *
 * @param domain - Domain to validate
 * @param csp - CSP configuration
 * @param type - Type of access ('connect' or 'resource')
 * @returns Whether the domain is allowed
 */
export function isDomainAllowed(domain: string, csp: McpAppsCSP | undefined, type: 'connect' | 'resource'): boolean {
  if (!csp) return false;

  const domains = type === 'connect' ? csp.connectDomains : csp.resourceDomains;

  if (!domains || domains.length === 0) return false;

  // Check if domain matches any allowed domain
  return domains.some((allowed) => {
    try {
      const allowedUrl = new URL(allowed);
      const testUrl = new URL(domain);

      // Match protocol and hostname
      return allowedUrl.protocol === testUrl.protocol && allowedUrl.hostname === testUrl.hostname;
    } catch {
      // If URL parsing fails, do exact string match
      return allowed === domain;
    }
  });
}

/**
 * Merge two CSP configurations.
 *
 * @param base - Base CSP configuration
 * @param override - Override CSP configuration
 * @returns Merged CSP configuration
 */
export function mergeCSP(base: McpAppsCSP | undefined, override: McpAppsCSP | undefined): McpAppsCSP {
  const merged: McpAppsCSP = {};

  // Merge connect domains
  const connectDomains = new Set<string>();
  if (base?.connectDomains) {
    base.connectDomains.forEach((d) => connectDomains.add(d));
  }
  if (override?.connectDomains) {
    override.connectDomains.forEach((d) => connectDomains.add(d));
  }
  if (connectDomains.size > 0) {
    merged.connectDomains = Array.from(connectDomains);
  }

  // Merge resource domains
  const resourceDomains = new Set<string>();
  if (base?.resourceDomains) {
    base.resourceDomains.forEach((d) => resourceDomains.add(d));
  }
  if (override?.resourceDomains) {
    override.resourceDomains.forEach((d) => resourceDomains.add(d));
  }
  if (resourceDomains.size > 0) {
    merged.resourceDomains = Array.from(resourceDomains);
  }

  return merged;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Escape string for use in HTML attribute.
 */
function escapeHtmlAttribute(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Parse CSP header string back to configuration.
 * Useful for testing and debugging.
 */
export function parseCSPHeader(header: string): McpAppsCSP {
  const csp: McpAppsCSP = {};
  const connectDomains: string[] = [];
  const resourceDomains: string[] = [];

  const directives = header.split(';').map((d) => d.trim());

  for (const directive of directives) {
    const [name, ...values] = directive.split(/\s+/);

    if (name === 'connect-src') {
      for (const value of values) {
        if (value.startsWith('https://') || value.startsWith('http://')) {
          connectDomains.push(value);
        }
      }
    }

    if (['script-src', 'style-src', 'img-src', 'font-src'].includes(name)) {
      for (const value of values) {
        if (value.startsWith('https://') || value.startsWith('http://')) {
          resourceDomains.push(value);
        }
      }
    }
  }

  if (connectDomains.length > 0) {
    csp.connectDomains = [...new Set(connectDomains)];
  }

  if (resourceDomains.length > 0) {
    csp.resourceDomains = [...new Set(resourceDomains)];
  }

  return csp;
}
