/**
 * Content Security Policy (CSP) Middleware
 *
 * Sets CSP headers based on deployment configuration.
 * Configured via `frontmcp.config` server.csp settings,
 * injected as environment variables at build time.
 */

import { getEnv, getEnvFlag } from '@frontmcp/utils';

import type { SecurityHeadersOptions } from '../../common/types/options/http/interfaces';

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
 * Set by the CLI (`frontmcp dev`, serverless setup templates) from frontmcp.config server.headers.
 * `off` / `false` / `none` omits a header.
 *
 * FRONTMCP_HSTS=max-age=31536000; includeSubDomains
 * FRONTMCP_CONTENT_TYPE_OPTIONS=nosniff
 * FRONTMCP_FRAME_OPTIONS=DENY
 * FRONTMCP_HEADERS_CUSTOM={"Referrer-Policy":"no-referrer"}
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
    hsts: readHeaderEnv('FRONTMCP_HSTS'),
    contentTypeOptions: readHeaderEnv('FRONTMCP_CONTENT_TYPE_OPTIONS', 'nosniff'),
    frameOptions: readHeaderEnv('FRONTMCP_FRAME_OPTIONS', 'DENY'),
    custom: readCustomHeadersFromEnv(),
  };
}

/** A header env var: unset gives `fallback`; `off` / `false` / `none` omits the header. */
function readHeaderEnv(name: string, fallback?: string): string | undefined {
  const value = getEnv(name);
  if (value === undefined || value === '') return fallback;
  return ['off', 'false', 'none'].includes(value.trim().toLowerCase()) ? undefined : value;
}

/** `FRONTMCP_HEADERS_CUSTOM` — a JSON object of extra response headers. Malformed values are ignored. */
function readCustomHeadersFromEnv(): Record<string, string> | undefined {
  const raw = getEnv('FRONTMCP_HEADERS_CUSTOM');
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    // fromEntries defines own properties, so a "__proto__" key cannot rewrite the prototype.
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return undefined;
  }
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

/**
 * Resolve the response security headers for a deployment as a plain header map.
 *
 * Precedence per header: explicit `options`, then the `FRONTMCP_*` env vars,
 * then the default (`nosniff`, `DENY`). `false` omits a header. Shared by the
 * Express host and the web-fetch handler so both send identical headers.
 */
export function resolveSecurityHeaders(options: SecurityHeadersOptions = {}): Record<string, string> {
  const env = readSecurityHeadersFromEnv();
  const pick = (explicit: string | false | undefined, fromEnv: string | undefined): string | undefined =>
    explicit === false ? undefined : (explicit ?? fromEnv);

  const resolved: SecurityHeaders = {
    hsts: pick(options.hsts, env.hsts),
    contentTypeOptions: pick(options.contentTypeOptions, env.contentTypeOptions),
    frameOptions: pick(options.frameOptions, env.frameOptions),
    custom: { ...env.custom, ...options.custom },
  };

  let csp: CspOptions | undefined;
  if (options.csp?.enabled === false) {
    csp = undefined;
  } else if (options.csp?.enabled === true) {
    const directives: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.csp.directives ?? {})) {
      directives[name] = Array.isArray(value) ? value.join(' ') : value;
    }
    csp = {
      enabled: true,
      directives,
      reportUri: options.csp.reportUri,
      reportOnly: options.csp.reportOnly ?? false,
    };
  } else {
    csp = readCspFromEnv();
  }

  const headers: Record<string, string> = {};
  applySecurityHeaders({ setHeader: (name, value) => void (headers[name] = value) }, resolved, csp);
  return headers;
}
