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
  valid: boolean;
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
   * Check if a client IP is allowed. A missing or unparseable IP gets `defaultAction` (GHSA-hwfp-xv2f-fr8g).
   */
  check(clientIp: string | undefined): IpFilterResult {
    const parsed = clientIp === undefined ? null : parseIp(clientIp);
    if (parsed === null) {
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
  isAllowListed(clientIp: string | undefined): boolean {
    const parsed = clientIp === undefined ? null : parseIp(clientIp);
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

const IPV4_MAPPED_PREFIX_BITS = 96;
const IPV4_MAPPED_MARKER = 0xffffn;
const IPV4_MASK = 0xffffffffn;
const IPV4_OCTET = /^\d{1,3}$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;
const PREFIX_LENGTH = /^\d{1,3}$/;
const ZONE_ID = /^[A-Za-z0-9_.~-]+$/;

/** Parse an IP to a bigint; an IPv4-mapped address parses as the IPv4 client it is (GHSA-hwfp-xv2f-fr8g). */
function parseIp(ip: string): ParsedIp | null {
  const parsed = parseAddress(ip);
  if (parsed === null || !isIpv4Mapped(parsed)) return parsed;
  return { value: parsed.value & IPV4_MASK, isV6: false };
}

/** Parse an address as written, keeping an IPv4-mapped address in IPv6 form. */
function parseAddress(ip: string): ParsedIp | null {
  const address = withoutZoneId(ip.trim());
  if (address === null) return null;

  if (address.includes(':')) {
    const value = parseIpv6(address);
    return value === null ? null : { value, isV6: true };
  }

  const value = parseIpv4(address);
  return value === null ? null : { value, isV6: false };
}

function isIpv4Mapped(ip: ParsedIp): boolean {
  return ip.isV6 && ip.value >> 32n === IPV4_MAPPED_MARKER;
}

/** Drop a `%zone` suffix: it names the local interface, not a different address. */
function withoutZoneId(ip: string): string | null {
  const zoneStart = ip.indexOf('%');
  if (zoneStart === -1) return ip;
  return ZONE_ID.test(ip.slice(zoneStart + 1)) ? ip.slice(0, zoneStart) : null;
}

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0n;
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = (result << 8n) | BigInt(octet);
  }
  return result;
}

function parseIpv6(ip: string): bigint | null {
  // A trailing dotted quad stands for the last two groups.
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  const hasEmbeddedIpv4 = tail.includes('.');
  const embeddedIpv4 = hasEmbeddedIpv4 ? parseIpv4(tail) : 0n;
  if (embeddedIpv4 === null) return null;

  const groups = expandIpv6Groups(hasEmbeddedIpv4 ? `${ip.slice(0, lastColon + 1)}0:0` : ip);
  if (groups === null) return null;

  let result = 0n;
  for (const group of groups) {
    if (!IPV6_GROUP.test(group)) return null;
    result = (result << 16n) | BigInt(parseInt(group, 16));
  }
  return result | embeddedIpv4;
}

/** The eight groups of an IPv6 address, with `::` expanded to the zero groups it stands for. */
function expandIpv6Groups(ip: string): string[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  if (halves.length === 1) {
    const groups = ip.split(':');
    return groups.length === 8 ? groups : null;
  }

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  // `::` always stands for at least one group.
  if (missing < 1) return null;
  return [...left, ...Array<string>(missing).fill('0'), ...right];
}

/**
 * Parse a CIDR notation string (e.g., "10.0.0.0/8" or "2001:db8::/32").
 * Plain IPs are treated as /32 (IPv4) or /128 (IPv6); a mapped rule (`::ffff:10.0.0.0/104`) is its IPv4 rule.
 */
function parseCidr(cidr: string): ParsedCidr {
  const [ipPart, prefixPart, ...extra] = cidr.split('/');
  const parsed = parseAddress(ipPart);

  if (parsed === null || extra.length > 0) {
    return { raw: cidr, ip: 0n, mask: 0n, isV6: false, valid: false };
  }

  const maxBits = parsed.isV6 ? 128 : 32;
  const prefixLen = prefixPart === undefined ? maxBits : parsePrefixLength(prefixPart);

  if (prefixLen === null || prefixLen > maxBits) {
    return { raw: cidr, ip: 0n, mask: 0n, isV6: parsed.isV6, valid: false };
  }

  if (isIpv4Mapped(parsed) && prefixLen >= IPV4_MAPPED_PREFIX_BITS) {
    return buildCidr(cidr, parsed.value & IPV4_MASK, prefixLen - IPV4_MAPPED_PREFIX_BITS, false);
  }
  return buildCidr(cidr, parsed.value, prefixLen, parsed.isV6);
}

function parsePrefixLength(prefix: string): number | null {
  return PREFIX_LENGTH.test(prefix) ? Number(prefix) : null;
}

function buildCidr(raw: string, value: bigint, prefixLen: number, isV6: boolean): ParsedCidr {
  const maxBits = isV6 ? 128 : 32;
  const mask = prefixLen === 0 ? 0n : ((1n << BigInt(maxBits)) - 1n) << BigInt(maxBits - prefixLen);
  return { raw, ip: value & mask, mask, isV6, valid: true };
}

/**
 * Check if a parsed IP matches a CIDR rule.
 */
function matchesCidr(ip: ParsedIp, rule: ParsedCidr): boolean {
  if (!rule.valid) return false;
  if (ip.isV6 !== rule.isV6) return false;
  return (ip.value & rule.mask) === rule.ip;
}
