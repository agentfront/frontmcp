/**
 * IP Filter Types
 */

/**
 * IP filtering configuration.
 */
export interface IpFilterConfig {
  /** IP addresses or CIDR ranges to always allow (bypass rate limiting). */
  allowList?: string[];
  /** IP addresses or CIDR ranges to always block. */
  denyList?: string[];
  /** Default action when IP matches neither list, or no client IP could be established. @default 'allow' */
  defaultAction?: 'allow' | 'deny';
  /** Not read; setting it logs a startup warning. Set `FRONTMCP_TRUST_PROXY` to trust X-Forwarded-For. @default false */
  trustProxy?: boolean;
  /** Not read; setting it logs a startup warning. Set `FRONTMCP_TRUSTED_PROXY_DEPTH` instead. @default 1 */
  trustedProxyDepth?: number;
}

/**
 * Result of an IP filter check.
 */
export interface IpFilterResult {
  /** Whether the request is allowed to proceed. */
  allowed: boolean;
  /** Reason for the decision. */
  reason?: 'allowlisted' | 'denylisted' | 'default';
  /** The specific rule that matched (IP or CIDR). */
  matchedRule?: string;
}
