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
  /** Default action when IP matches neither list. @default 'allow' */
  defaultAction?: 'allow' | 'deny';
  /** Trust X-Forwarded-For header. @default false */
  trustProxy?: boolean;
  /** Max number of proxies to trust from X-Forwarded-For. @default 1 */
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
