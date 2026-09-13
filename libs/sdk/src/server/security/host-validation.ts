/**
 * Host / Origin validation — the server-side half of DNS-rebinding protection
 * (GHSA-mc9g-v2cp-vfff).
 *
 * A page on an attacker-controlled domain can rebind that domain to the
 * victim's loopback address and then reach a local MCP server. The browser
 * treats the result as same-origin, so CORS does not apply and binding to
 * loopback does not help — loopback is the *destination* of the rebind. What
 * does apply is that the request still names the attacker's hostname in `Host`,
 * because that is the name the page was loaded from.
 *
 * This module is transport-agnostic on purpose: the Express adapter and the
 * web-fetch (Worker/edge) handler both call it, so the two cannot drift apart
 * (see .claude/rules/flow-architecture.md — adapters translate, they do not
 * decide).
 */

/** Ports that are implied by a scheme and therefore omitted from `Host`. */
const DEFAULT_PORTS = new Set(['80', '443']);

export interface HostValidationRules {
  /** Allowed `Host` values. Undefined disables host checking. */
  allowedHosts?: string[];
  /** Allowed `Origin` values. Undefined disables origin checking. */
  allowedOrigins?: string[];
}

export interface HostValidationRejection {
  status: 403;
  error: 'Forbidden';
  message: string;
}

/**
 * Normalize a `Host` header for comparison.
 *
 * Hostnames are case-insensitive, and a default port may be present or omitted
 * for the same host, so both forms normalize to the same key. IPv6 literals
 * keep their brackets — `[::1]` and `::1` are different spellings of a host, and
 * only the bracketed form is legal in a `Host` header.
 */
export function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (host.length === 0) return host;

  // Split host from port without tripping over IPv6 colons.
  const portSeparator = host.startsWith('[') ? host.indexOf(':', host.indexOf(']')) : host.lastIndexOf(':');
  if (portSeparator === -1) return host;

  const name = host.slice(0, portSeparator);
  const port = host.slice(portSeparator + 1);
  // A non-numeric "port" means this colon was part of the host, not a separator.
  if (port.length === 0 || !/^\d+$/.test(port)) return host;
  return DEFAULT_PORTS.has(port) ? name : `${name}:${port}`;
}

/** Normalize an `Origin` header (scheme + host, default port elided). */
export function normalizeOrigin(value: string): string {
  const origin = value.trim().toLowerCase();
  const schemeEnd = origin.indexOf('://');
  if (schemeEnd === -1) return origin;
  return `${origin.slice(0, schemeEnd)}://${normalizeHost(origin.slice(schemeEnd + 3))}`;
}

/** Precompiled rules — build once per server, not per request. */
export interface CompiledHostValidation {
  hosts?: Set<string>;
  origins?: Set<string>;
}

export function compileHostValidation(rules: HostValidationRules): CompiledHostValidation {
  return {
    hosts: rules.allowedHosts ? new Set(rules.allowedHosts.map(normalizeHost)) : undefined,
    origins: rules.allowedOrigins ? new Set(rules.allowedOrigins.map(normalizeOrigin)) : undefined,
  };
}

/**
 * Validate a request's `Host`, `X-Forwarded-Host` and `Origin` headers.
 *
 * @returns `undefined` when the request is allowed, or the rejection to render.
 */
export function validateHostHeaders(
  headers: {
    host?: string | undefined;
    forwardedHost?: string | undefined;
    origin?: string | undefined;
  },
  compiled: CompiledHostValidation,
): HostValidationRejection | undefined {
  if (compiled.hosts) {
    const host = headers.host;
    if (!host || !compiled.hosts.has(normalizeHost(host))) {
      return { status: 403, error: 'Forbidden', message: 'Invalid Host header' };
    }

    // Also validate `X-Forwarded-Host` when present. Issuer / resource /
    // OAuth-discovery URLs may be derived from it (when FRONTMCP_TRUST_PROXY is
    // enabled), so a poisoned forwarded host must be rejected here too —
    // otherwise a request with a valid `Host` but a spoofed `X-Forwarded-Host`
    // slips past this allowlist and poisons discovery. A forwarded host may
    // carry a comma-separated proxy chain.
    const forwardedHost = headers.forwardedHost;
    if (forwardedHost) {
      const candidates = forwardedHost
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);
      if (candidates.some((h) => !compiled.hosts?.has(normalizeHost(h)))) {
        return { status: 403, error: 'Forbidden', message: 'Invalid X-Forwarded-Host header' };
      }
    }
  }

  // Origin is only checked when present: non-browser clients (CLI agents, other
  // servers) legitimately send none, and rejecting those would break every
  // non-browser MCP client without adding any rebinding protection — a rebound
  // page always sends one.
  if (compiled.origins) {
    const origin = headers.origin;
    if (origin && !compiled.origins.has(normalizeOrigin(origin))) {
      return { status: 403, error: 'Forbidden', message: 'Invalid Origin header' };
    }
  }

  return undefined;
}
