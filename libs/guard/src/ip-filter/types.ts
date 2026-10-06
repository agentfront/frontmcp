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
  /** Read the client IP from X-Forwarded-For behind `trustedProxyDepth` proxies; `false` leaves it to `FRONTMCP_TRUST_PROXY`. @default false */
  trustProxy?: boolean;
  /** Proxies in front of the server that append to X-Forwarded-For; read when `trustProxy` is true. @default 1 */
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
