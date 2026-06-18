// file: plugins/plugin-skilled-openapi/src/executor/ssrf-guard.ts
//
// Layered SSRF defense applied before every outbound HTTP request:
//
//   1. Scheme allowlist: https: by default; http: only when allowHttp=true
//      AND the host is a declared service base URL host.
//   2. Hostname allowlist: hostname must equal a declared service host.
//   3. ALWAYS-ON metadata/link-local denylist (independent of
//      `allowPrivateNetworks`): cloud metadata hostnames, the 169.254.0.0/16
//      link-local range (incl. 169.254.169.254 IMDS), IPv6 link-local
//      (fe80::/10), and the AWS IMDSv6 literal fd00:ec2::254 are blocked even
//      for self-hosted deployments — there is no legitimate upstream there, and
//      it is the prime SSRF target (SECURITY-REVIEW B2/B4).
//   4. Private-network blocklist (RFC 1918, loopback, CGNAT 100.64.0.0/10, IPv6
//      ULA): applied to both IP-literal hosts and resolved names UNLESS
//      `allowPrivateNetworks: true`.
//
// IP-literal hosts (e.g. `http://169.254.169.254/`, `http://[fd00:ec2::254]/`)
// are validated DIRECTLY without DNS — so the metadata/private checks apply on
// every runtime, including V8 isolates where `node:dns` is absent.
//
// The IP is checked but NOT pinned into the actual fetch in v1.2 OSS — under
// undici this requires a custom Dispatcher and is left for v1.2.x. The
// OS-level resolver typically reuses the same IP for the immediately-following
// fetch, so in practice this catches direct attacks; targeted DNS-rebinding
// against a tight time window is the documented residual risk (B5).

import type { OutboundOptions } from '../skilled-openapi.types';

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
}

const PRIVATE_IPV4_BLOCKS: { net: number; mask: number }[] = [
  // RFC 1918
  { net: ipv4ToInt('10.0.0.0'), mask: 0xff000000 },
  { net: ipv4ToInt('172.16.0.0'), mask: 0xfff00000 },
  { net: ipv4ToInt('192.168.0.0'), mask: 0xffff0000 },
  // Loopback
  { net: ipv4ToInt('127.0.0.0'), mask: 0xff000000 },
  // Carrier-grade NAT (RFC 6598) — routable-looking but private; a common
  // SSRF blind spot (SECURITY-REVIEW B4).
  { net: ipv4ToInt('100.64.0.0'), mask: 0xffc00000 },
];

// ALWAYS forbidden, regardless of `allowPrivateNetworks`. These ranges host
// cloud instance-metadata services (IMDS) and link-local addresses that no
// legitimate upstream API uses — allowing them would re-open the prime SSRF
// target even on self-hosted deployments that legitimately reach RFC 1918.
const ALWAYS_FORBIDDEN_IPV4_BLOCKS: { net: number; mask: number }[] = [
  // Link-local incl. AWS/GCP/Azure metadata 169.254.169.254
  { net: ipv4ToInt('169.254.0.0'), mask: 0xffff0000 },
  // "this host on this network" / unspecified
  { net: ipv4ToInt('0.0.0.0'), mask: 0xff000000 },
];

function ipv4ToInt(ip: string): number {
  // Avoid `parts[0] << 24` because JS shifts coerce to int32 first, flipping
  // the sign bit for any first octet ≥ 128. Multiply for the high byte and
  // shift safely for the lower three; coerce to unsigned at the end.
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return 0;
  const [a, b, c, d] = parts as [number, number, number, number];
  return (a * 0x01000000 + ((b << 16) >>> 0) + ((c << 8) >>> 0) + d) >>> 0;
}

function isValidIPv4(ip: string): boolean {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return false;
  return ip.split('.').every((p) => {
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function matchesBlock(ip: string, blocks: { net: number; mask: number }[]): boolean {
  const v = ipv4ToInt(ip);
  // `&` truncates to int32 (signed); `>>> 0` reinterprets as unsigned so the
  // comparison against `b.net` (always unsigned) is correct.
  return blocks.some((b) => (v & b.mask) >>> 0 === b.net);
}

export function isPrivateIPv4(ip: string): boolean {
  if (!isValidIPv4(ip)) return false;
  // "Private" is the superset of non-public ranges: RFC 1918 / loopback / CGNAT
  // PLUS the always-forbidden link-local + unspecified ranges. The two sets are
  // distinguished only for the `allowPrivateNetworks` bypass — the always set is
  // checked first and blocks even when private networks are permitted.
  return matchesBlock(ip, PRIVATE_IPV4_BLOCKS) || matchesBlock(ip, ALWAYS_FORBIDDEN_IPV4_BLOCKS);
}

/** Metadata / link-local IPv4 — blocked even when `allowPrivateNetworks` is on. */
export function isAlwaysForbiddenIPv4(ip: string): boolean {
  if (!isValidIPv4(ip)) return false;
  return matchesBlock(ip, ALWAYS_FORBIDDEN_IPV4_BLOCKS);
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6
    const v4 = lower.slice('::ffff:'.length);
    return isPrivateIPv4(v4);
  }
  return false;
}

/** Metadata / link-local IPv6 — blocked even when `allowPrivateNetworks` is on. */
export function isAlwaysForbiddenIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv6 link-local fe80::/10
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true;
  // AWS IMDSv6 endpoint.
  if (lower === 'fd00:ec2::254') return true;
  // Unspecified address.
  if (lower === '::') return true;
  // IPv4-mapped metadata/link-local (e.g. ::ffff:169.254.169.254).
  if (lower.startsWith('::ffff:')) {
    return isAlwaysForbiddenIPv4(lower.slice('::ffff:'.length));
  }
  return false;
}

const FORBIDDEN_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata.aws.com',
  // GCP legacy + Alibaba/OpenStack-style metadata hostnames.
  'metadata',
  'metadata.goog',
]);

/**
 * Strip IPv6 brackets and classify a hostname as an IP literal.
 * `new URL('http://[::1]/').hostname` yields `[::1]` on most runtimes; this
 * normalizes so the IP checks see the bare address.
 */
function classifyHostLiteral(hostname: string): { kind: 'v4' | 'v6' | 'name'; ip: string } {
  let h = hostname;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (isValidIPv4(h)) return { kind: 'v4', ip: h };
  // An IPv6 literal contains a colon; a DNS name never does.
  if (h.includes(':')) return { kind: 'v6', ip: h };
  return { kind: 'name', ip: h };
}

/**
 * Validate an outbound URL against the allowlist + scheme rules + IP blocklist.
 *
 * @param target - The target URL (post path/query interpolation).
 * @param allowedHosts - Set of hostnames declared by the active bundle's services.
 * @param outbound - Plugin's outbound options (allowHttp, allowPrivateNetworks).
 */
export async function checkOutboundUrl(
  target: string,
  allowedHosts: ReadonlySet<string>,
  outbound: OutboundOptions,
): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, reason: `invalid URL: ${target}` };
  }

  if (url.protocol !== 'https:' && !(outbound.allowHttp && url.protocol === 'http:')) {
    return { ok: false, reason: `forbidden scheme "${url.protocol}" (https: required)` };
  }

  const hostname = url.hostname.toLowerCase();
  if (FORBIDDEN_METADATA_HOSTS.has(hostname)) {
    return { ok: false, reason: `cloud metadata hostname "${hostname}" is blocked` };
  }
  if (!allowedHosts.has(hostname)) {
    return { ok: false, reason: `hostname "${hostname}" is not in the bundle's declared services` };
  }

  const literal = classifyHostLiteral(hostname);

  // IP-LITERAL host: validate directly, no DNS needed. The always-forbidden
  // (metadata/link-local) checks apply even when allowPrivateNetworks is on.
  if (literal.kind === 'v4') {
    if (isAlwaysForbiddenIPv4(literal.ip)) {
      return { ok: false, reason: `metadata/link-local IPv4 ${literal.ip} is always blocked` };
    }
    if (!outbound.allowPrivateNetworks && isPrivateIPv4(literal.ip)) {
      return { ok: false, reason: `private/loopback IPv4 ${literal.ip} is blocked` };
    }
    return { ok: true };
  }
  if (literal.kind === 'v6') {
    if (isAlwaysForbiddenIPv6(literal.ip)) {
      return { ok: false, reason: `metadata/link-local IPv6 ${literal.ip} is always blocked` };
    }
    if (!outbound.allowPrivateNetworks && isPrivateIPv6(literal.ip)) {
      return { ok: false, reason: `private IPv6 ${literal.ip} is blocked` };
    }
    return { ok: true };
  }

  // NAME host: resolve to IP(s) and check the blocklist. `node:dns` is imported
  // lazily — only when we actually need to resolve — so a V8-isolate runtime
  // (Cloudflare Worker), where `node:dns` is absent and egress is already
  // platform-sandboxed, never loads it at module-eval.
  let addresses: Array<{ address: string; family: number }>;
  try {
    const { promises: dns } = await import('node:dns');
    addresses = await dns.lookup(literal.ip, { all: true });
  } catch (e) {
    if (!outbound.allowPrivateNetworks) {
      // Fail closed: we cannot prove the host doesn't resolve into a blocked range.
      return { ok: false, reason: `DNS resolution failed for "${hostname}": ${(e as Error).message}` };
    }
    // allowPrivateNetworks + no resolver (e.g. Worker): IP-literal metadata is
    // already blocked above and platform egress rules sandbox the rest. The
    // allowlist still constrains the host to a declared service. Allow.
    return { ok: true };
  }

  for (const a of addresses) {
    if (a.family === 4) {
      if (isAlwaysForbiddenIPv4(a.address)) {
        return { ok: false, reason: `host "${hostname}" resolved to metadata/link-local IPv4 ${a.address}` };
      }
      if (!outbound.allowPrivateNetworks && isPrivateIPv4(a.address)) {
        return { ok: false, reason: `host "${hostname}" resolved to private/loopback IPv4 ${a.address}` };
      }
    }
    if (a.family === 6) {
      if (isAlwaysForbiddenIPv6(a.address)) {
        return { ok: false, reason: `host "${hostname}" resolved to metadata/link-local IPv6 ${a.address}` };
      }
      if (!outbound.allowPrivateNetworks && isPrivateIPv6(a.address)) {
        return { ok: false, reason: `host "${hostname}" resolved to private IPv6 ${a.address}` };
      }
    }
  }

  return { ok: true };
}
