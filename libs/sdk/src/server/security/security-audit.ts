/**
 * Security Audit — Production Readiness Warnings
 *
 * Logs security-relevant configuration at server startup.
 * Warn-only approach: no defaults are changed, but insecure
 * configurations are flagged in production environments.
 */

import type { CorsOptions } from '../../common';

/**
 * Security configuration for the audit.
 */
export interface SecurityAuditConfig {
  /** CORS configuration (undefined = permissive default) */
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

  // CORS audit — suppress raw-config warnings when strict mode handles it
  if (config.cors === undefined && !strict) {
    findings.push({
      level: 'warn',
      code: 'CORS_PERMISSIVE_DEFAULT',
      message: 'CORS is using the permissive default (origin: true), which allows all origins.',
      recommendation: 'Set explicit cors.origin to restrict allowed origins in production.',
    });
  } else if (config.cors !== false && config.cors?.origin === true && !strict) {
    findings.push({
      level: 'warn',
      code: 'CORS_ORIGIN_TRUE',
      message: 'CORS origin=true allows all origins to make cross-origin requests.',
      recommendation: 'Set cors.origin to specific allowed origins.',
    });
  } else if (config.cors === false) {
    findings.push({
      level: 'info',
      code: 'CORS_DISABLED',
      message: 'CORS is disabled. Cross-origin requests will be blocked by browsers.',
    });
  } else {
    findings.push({
      level: 'info',
      code: 'CORS_CONFIGURED',
      message: 'CORS is explicitly configured.',
    });
  }

  // Bind address audit
  const bindAddress = config.resolvedBindAddress ?? '0.0.0.0';
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
      message: 'Strict security mode is enabled: loopback binding, restrictive CORS, DNS rebinding protection.',
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
 * Resolve the effective bind address based on configuration and deployment mode.
 *
 * @param security - Security configuration
 * @param deploymentMode - Current deployment mode
 * @returns Resolved IP address string
 */
export function resolveBindAddress(security?: SecurityAuditConfig['security'], deploymentMode?: string): string {
  // Explicit bind address takes priority
  if (security?.bindAddress) {
    if (security.bindAddress === 'loopback') return '127.0.0.1';
    if (security.bindAddress === 'all') return '0.0.0.0';
    return security.bindAddress;
  }

  // Strict mode: loopback for standalone, all for distributed
  if (security?.strict) {
    return deploymentMode === 'distributed' ? '0.0.0.0' : '127.0.0.1';
  }

  // Default: 0.0.0.0 (backwards compatible — no breaking changes)
  return '0.0.0.0';
}
