/**
 * Content Security Policy (CSP) Middleware
 *
 * Sets CSP headers based on deployment configuration.
 * Configured via `frontmcp.config` server.csp settings,
 * injected as environment variables at build time.
 */

import { getEnv, getEnvFlag } from '@frontmcp/utils';

/**
 * CSP configuration read from environment variables (set by build adapter).
 */
export interface CspOptions {
  /** Enable CSP headers. */
  enabled: boolean;
  /** CSP directives map. */
  directives: Record<string, string>;
  /** Report URI for violations. */
  reportUri?: string;
  /** Use Report-Only header instead of enforcement. */
  reportOnly: boolean;
}

/**
 * Read CSP configuration from environment variables.
 * Environment variables are injected by the build adapter from frontmcp.config.
 *
 * FRONTMCP_CSP_ENABLED=1
 * FRONTMCP_CSP_DIRECTIVES=default-src 'self'; script-src 'self' https://cdn.example.com
 * FRONTMCP_CSP_REPORT_URI=https://report.example.com/csp
 * FRONTMCP_CSP_REPORT_ONLY=1
 */
export function readCspFromEnv(): CspOptions | undefined {
  if (!getEnvFlag('FRONTMCP_CSP_ENABLED')) return undefined;

  const rawDirectives = getEnv('FRONTMCP_CSP_DIRECTIVES') ?? '';
  const directives: Record<string, string> = {};

  // Parse "directive1 value1; directive2 value2" format
  for (const part of rawDirectives.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx > 0) {
      directives[trimmed.slice(0, spaceIdx)] = trimmed.slice(spaceIdx + 1);
    } else {
      directives[trimmed] = '';
    }
  }

  return {
    enabled: true,
    directives,
    reportUri: getEnv('FRONTMCP_CSP_REPORT_URI'),
    reportOnly: getEnvFlag('FRONTMCP_CSP_REPORT_ONLY'),
  };
}

/**
 * Build the CSP header value from directives.
 */
export function buildCspHeaderValue(options: CspOptions): string {
  const parts: string[] = [];

  for (const [directive, value] of Object.entries(options.directives)) {
    parts.push(value ? `${directive} ${value}` : directive);
  }

  if (options.reportUri) {
    parts.push(`report-uri ${options.reportUri}`);
  }

  return parts.join('; ');
}

/**
 * Get the CSP header name based on report-only mode.
 */
export function getCspHeaderName(reportOnly: boolean): string {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

/**
 * Security headers read from environment variables.
 * Set by the build adapter from frontmcp.config server.headers settings.
 *
 * FRONTMCP_HSTS=max-age=31536000; includeSubDomains
 * FRONTMCP_CONTENT_TYPE_OPTIONS=nosniff
 * FRONTMCP_FRAME_OPTIONS=DENY
 */
export interface SecurityHeaders {
  hsts?: string;
  contentTypeOptions?: string;
  frameOptions?: string;
  custom?: Record<string, string>;
}

/**
 * Read security headers from environment variables.
 */
export function readSecurityHeadersFromEnv(): SecurityHeaders {
  return {
    hsts: getEnv('FRONTMCP_HSTS'),
    contentTypeOptions: getEnv('FRONTMCP_CONTENT_TYPE_OPTIONS') ?? 'nosniff',
    frameOptions: getEnv('FRONTMCP_FRAME_OPTIONS') ?? 'DENY',
  };
}

/**
 * Apply security headers to a response object.
 * Called by the HTTP adapter on every response.
 */
export function applySecurityHeaders(
  res: { setHeader(name: string, value: string): void },
  headers: SecurityHeaders,
  csp?: CspOptions,
): void {
  if (headers.hsts) {
    res.setHeader('Strict-Transport-Security', headers.hsts);
  }
  if (headers.contentTypeOptions) {
    res.setHeader('X-Content-Type-Options', headers.contentTypeOptions);
  }
  if (headers.frameOptions) {
    res.setHeader('X-Frame-Options', headers.frameOptions);
  }
  if (headers.custom) {
    for (const [name, value] of Object.entries(headers.custom)) {
      res.setHeader(name, value);
    }
  }
  if (csp?.enabled) {
    const headerName = getCspHeaderName(csp.reportOnly);
    const headerValue = buildCspHeaderValue(csp);
    if (headerValue) {
      res.setHeader(headerName, headerValue);
    }
  }
}
