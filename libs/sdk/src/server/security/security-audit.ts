/**
 * Security Audit — Production Readiness Warnings
 *
 * Logs security-relevant configuration at server startup so an operator can see
 * what the transport actually exposes. The audit only reports — it never changes
 * behaviour; the safe choices are the defaults themselves (loopback binding, no
 * CORS headers), and this flags where a config opts out of them.
 */

import type { CorsOptions } from '../../common';

/**
 * Security configuration for the audit.
 */
export interface SecurityAuditConfig {
  /** CORS configuration (undefined = the default: no CORS headers, same-origin only) */
  cors?: CorsOptions | false;
  /** Security options from HttpOptionsInterface */
  security?: {
    strict?: boolean;
    bindAddress?: 'loopback' | 'all' | string;
    dnsRebindingProtection?: {
      enabled?: boolean;
      allowedHosts?: string[];
      allowedOrigins?: string[];
    };
  };
  /** Resolved bind address (what the server actually binds to) */
  resolvedBindAddress?: string;
  /** Deployment mode */
  deploymentMode?: string;
}

/**
 * Individual security finding.
 */
export interface SecurityFinding {
  level: 'warn' | 'info';
  code: string;
  message: string;
  recommendation?: string;
}

/**
 * Audit security configuration and return findings.
 * Called at server startup to produce log warnings.
 *
 * @param config - Current security-relevant configuration
 * @param isProduction - Whether NODE_ENV is 'production'
 * @returns Array of security findings
 */
export function auditSecurityDefaults(config: SecurityAuditConfig, isProduction: boolean): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Only audit in production or distributed mode
  if (!isProduction && config.deploymentMode !== 'distributed') {
    return findings;
  }

  const strict = config.security?.strict === true;

  // CORS audit.
  //
  // The audit must report what the adapter actually does. ExpressHostAdapter installs the CORS
  // middleware only when `origin` is neither `undefined` nor `false`, so `cors: undefined`,
  // `cors: false`, `cors: {}` and `cors: { origin: false }` are ALL the same runtime state — no
  // headers — and must report identically. Reporting `cors: {}` as "explicitly configured" told
  // operators they had CORS when the middleware was never installed.
  //
  // Omitting `cors` is the safe default now, not a permissive one, so it is not a warning. The
  // only permissive state left is an explicit `{ origin: true }`, and that stays a warning
  // whatever `strict` says: strict mode does not touch CORS, so it has nothing to suppress here.
  const corsOrigin = config.cors === false ? undefined : config.cors?.origin;
  if (corsOrigin === undefined || corsOrigin === false) {
    findings.push({
      level: 'info',
      code: 'CORS_DISABLED',
      message:
        'No CORS headers are sent. Cross-origin requests still reach the server — a browser just ' +
        'will not let the calling page read the response. CORS is not server-side access control.',
    });
  } else if (corsOrigin === true) {
    findings.push({
      level: 'warn',
      code: 'CORS_ORIGIN_TRUE',
      message: 'CORS origin=true allows all origins to make cross-origin requests.',
      recommendation: 'Set cors.origin to specific allowed origins.',
    });
  } else {
    findings.push({
      level: 'info',
      code: 'CORS_CONFIGURED',
      message: 'CORS is explicitly configured.',
    });
  }

  // Bind address audit. The fallback must match resolveBindAddress()'s default, or a caller that
  // omits `resolvedBindAddress` gets warned about an exposure that isn't there.
  const bindAddress = config.resolvedBindAddress ?? '127.0.0.1';
  if (bindAddress === '0.0.0.0' || bindAddress === '::') {
    if (config.deploymentMode !== 'distributed') {
      findings.push({
        level: 'warn',
        code: 'BIND_ALL_INTERFACES',
        message: `Server bound to ${bindAddress} — accessible from all network interfaces.`,
        recommendation:
          "Set security.bindAddress to 'loopback' or '127.0.0.1' for local-only access, " +
          "or configure a reverse proxy. Distributed deployments require 'all' (0.0.0.0).",
      });
    } else {
      findings.push({
        level: 'info',
        code: 'BIND_ALL_INTERFACES_DISTRIBUTED',
        message: `Server bound to ${bindAddress} (expected for distributed deployment).`,
      });
    }
  } else {
    findings.push({
      level: 'info',
      code: 'BIND_RESTRICTED',
      message: `Server bound to ${bindAddress}.`,
    });
  }

  // DNS rebinding protection audit — strict mode implies protection is enabled
  const dnsProtectionEnabled = config.security?.dnsRebindingProtection?.enabled ?? strict;
  if (!dnsProtectionEnabled) {
    findings.push({
      level: 'warn',
      code: 'DNS_REBINDING_UNPROTECTED',
      message: 'DNS rebinding protection is disabled.',
      recommendation: 'Enable security.dnsRebindingProtection with allowedHosts to prevent DNS rebinding attacks.',
    });
  } else {
    findings.push({
      level: 'info',
      code: 'DNS_REBINDING_PROTECTED',
      message: 'DNS rebinding protection is enabled.',
    });
  }

  // Strict mode info
  if (config.security?.strict) {
    findings.push({
      level: 'info',
      code: 'STRICT_MODE_ENABLED',
      message:
        config.deploymentMode === 'distributed'
          ? 'Strict security mode is enabled: DNS rebinding protection. Binding is unchanged for a ' +
            'distributed deployment — it still listens on all interfaces so peers can reach it.'
          : 'Strict security mode is enabled: loopback binding and DNS rebinding protection.',
    });
  } else {
    findings.push({
      level: 'info',
      code: 'STRICT_MODE_HINT',
      message: 'To enable strict security defaults, set security.strict = true in HttpOptions.',
    });
  }

  return findings;
}

/**
 * Format and log security findings.
 *
 * @param findings - Security findings from auditSecurityDefaults
 * @param logger - Logger with info/warn methods
 */
export function logSecurityFindings(
  findings: SecurityFinding[],
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  },
): void {
  if (findings.length === 0) return;

  for (const finding of findings) {
    const prefix = `[Security] ${finding.code}:`;
    const message = finding.recommendation
      ? `${prefix} ${finding.message} ${finding.recommendation}`
      : `${prefix} ${finding.message}`;

    if (finding.level === 'warn') {
      logger.warn(message);
    } else {
      logger.info(message);
    }
  }
}

/**
 * Map a bind-address token to the address the server actually listens on.
 * `'loopback'` / `'all'` are the two aliases; anything else is taken literally.
 */
function toBindAddress(value: string): string {
  if (value === 'loopback') return '127.0.0.1';
  if (value === 'all') return '0.0.0.0';
  return value;
}

/**
 * Resolve the effective bind address based on configuration and deployment mode.
 *
 * Precedence: explicit config > FRONTMCP_BIND_ADDRESS > strict mode > deployment mode > loopback.
 *
 * @param security - Security configuration
 * @param deploymentMode - Current deployment mode
 * @returns Resolved IP address string
 */
export function resolveBindAddress(security?: SecurityAuditConfig['security'], deploymentMode?: string): string {
  // Explicit bind address takes priority
  if (security?.bindAddress) {
    return toBindAddress(security.bindAddress);
  }

  // FRONTMCP_BIND_ADDRESS — the ops-side opt-in. A container publishes a port and expects the
  // process inside to listen on every interface, but a Dockerfile can't reach into the server's
  // TypeScript config. This lets the deployment say `FRONTMCP_BIND_ADDRESS=all` without a rebuild,
  // and keeps the safe default for everyone who says nothing. Accepts 'all', 'loopback', or a
  // literal address.
  const envBindAddress = process.env['FRONTMCP_BIND_ADDRESS']?.trim();
  if (envBindAddress) {
    return toBindAddress(envBindAddress);
  }

  // Strict mode: loopback for standalone, all for distributed
  if (security?.strict) {
    return deploymentMode === 'distributed' ? '0.0.0.0' : '127.0.0.1';
  }

  // A distributed deployment must be reachable by its peers — that is what the mode means.
  if (deploymentMode === 'distributed') return '0.0.0.0';

  // Default: LOOPBACK.
  //
  // This was `0.0.0.0` "for backwards compatibility", which meant a server that said nothing about
  // security published itself on every interface. Combined with auth being opt-in, that put
  // unauthenticated MCP endpoints — tools, jobs, telemetry — on the network by default; a downstream
  // consumer shipped exactly that. A default should be the safe choice, and the unsafe one should be
  // a sentence someone wrote on purpose: `security.bindAddress: 'all'`, the FRONTMCP_BIND_ADDRESS
  // env var, or a distributed build (`frontmcp build --target distributed`, which sets
  // FRONTMCP_DEPLOYMENT_MODE=distributed).
  return '127.0.0.1';
}
