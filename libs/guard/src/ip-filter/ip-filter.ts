/**
 * IP Filter
 *
 * Allow/deny list with CIDR support for IPv4 and IPv6.
 * Pure computation — no storage or external dependencies.
 */

import type { IpFilterConfig, IpFilterResult } from './types';

/**
 * Parsed CIDR rule for fast matching.
 */
interface ParsedCidr {
  raw: string;
  ip: bigint;
  mask: bigint;
  isV6: boolean;
}

export class IpFilter {
  private readonly allowRules: ParsedCidr[];
  private readonly denyRules: ParsedCidr[];
  private readonly defaultAction: 'allow' | 'deny';

  constructor(config: IpFilterConfig) {
    this.allowRules = (config.allowList ?? []).map(parseCidr);
    this.denyRules = (config.denyList ?? []).map(parseCidr);
    this.defaultAction = config.defaultAction ?? 'allow';
  }

  /**
   * Check if a client IP is allowed.
   */
  check(clientIp: string): IpFilterResult {
    const parsed = parseIp(clientIp);
    if (parsed === null) {
      // Unparseable IP — apply default action
      return { allowed: this.defaultAction === 'allow', reason: 'default' };
    }

    // Deny list takes precedence over allow list
    for (const rule of this.denyRules) {
      if (matchesCidr(parsed, rule)) {
        return { allowed: false, reason: 'denylisted', matchedRule: rule.raw };
      }
    }

    // Check allow list
    if (this.allowRules.length > 0) {
      for (const rule of this.allowRules) {
        if (matchesCidr(parsed, rule)) {
          return { allowed: true, reason: 'allowlisted', matchedRule: rule.raw };
        }
      }
      // Has allow list but IP didn't match any — deny
      if (this.defaultAction === 'deny') {
        return { allowed: false, reason: 'default' };
      }
    }

    return { allowed: this.defaultAction === 'allow', reason: 'default' };
  }

  /**
   * Check if an IP is on the allow list (bypasses rate limiting).
   */
  isAllowListed(clientIp: string): boolean {
    const parsed = parseIp(clientIp);
    if (parsed === null) return false;
    return this.allowRules.some((rule) => matchesCidr(parsed, rule));
  }
}

// ============================================
// IP Parsing & CIDR Matching
// ============================================

interface ParsedIp {
  value: bigint;
  isV6: boolean;
}

/**
 * Parse an IP address string to a bigint representation.
 * Supports IPv4, IPv6, and IPv4-mapped IPv6 (::ffff:x.x.x.x).
 */
function parseIp(ip: string): ParsedIp | null {
  const trimmed = ip.trim();

  // IPv4
  if (trimmed.includes('.') && !trimmed.includes(':')) {
    const value = parseIpv4(trimmed);
    if (value === null) return null;
    return { value, isV6: false };
  }

  // IPv6 (may contain embedded IPv4)
  if (trimmed.includes(':')) {
    const value = parseIpv6(trimmed);
    if (value === null) return null;
    return { value, isV6: true };
  }

  return null;
}

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0n;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8n) | BigInt(num);
  }
  return result;
}

function parseIpv6(ip: string): bigint | null {
  // Handle IPv4-mapped IPv6 (::ffff:1.2.3.4)
  const v4MappedMatch = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch) {
    const v4 = parseIpv4(v4MappedMatch[1]);
    if (v4 === null) return null;
    return 0xffff00000000n | v4;
  }

  // Expand :: shorthand
  let expanded = ip;
  if (expanded.includes('::')) {
    const halves = expanded.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    const middle = Array(missing).fill('0');
    expanded = [...left, ...middle, ...right].join(':');
  }

  const groups = expanded.split(':');
  if (groups.length !== 8) return null;

  let result = 0n;
  for (const group of groups) {
    const num = parseInt(group, 16);
    if (isNaN(num) || num < 0 || num > 0xffff) return null;
    result = (result << 16n) | BigInt(num);
  }
  return result;
}

/**
 * Parse a CIDR notation string (e.g., "10.0.0.0/8" or "2001:db8::/32").
 * Plain IPs are treated as /32 (IPv4) or /128 (IPv6).
 */
function parseCidr(cidr: string): ParsedCidr {
  const [ipPart, prefixPart] = cidr.split('/');
  const parsed = parseIp(ipPart);

  if (parsed === null) {
    // Invalid — create a rule that never matches
    return { raw: cidr, ip: 0n, mask: 0n, isV6: false };
  }

  const maxBits = parsed.isV6 ? 128 : 32;
  const prefixLen = prefixPart !== undefined ? parseInt(prefixPart, 10) : maxBits;

  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > maxBits) {
    return { raw: cidr, ip: 0n, mask: 0n, isV6: parsed.isV6 };
  }

  const mask = prefixLen === 0 ? 0n : ((1n << BigInt(maxBits)) - 1n) << BigInt(maxBits - prefixLen);

  return {
    raw: cidr,
    ip: parsed.value & mask,
    mask,
    isV6: parsed.isV6,
  };
}

/**
 * Check if a parsed IP matches a CIDR rule.
 */
function matchesCidr(ip: ParsedIp, rule: ParsedCidr): boolean {
  // Type mismatch (IPv4 vs IPv6) — no match
  if (ip.isV6 !== rule.isV6) return false;
  return (ip.value & rule.mask) === rule.ip;
}
