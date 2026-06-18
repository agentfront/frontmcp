// file: plugins/plugin-skilled-openapi/src/executor/ssrf-guard.ts
//
// Layered SSRF defense applied before every outbound HTTP request:
//
//   1. Scheme allowlist: https: by default; http: only when allowHttp=true
//      AND the host is a declared service base URL host.
//   2. Hostname allowlist: hostname must equal a declared service host.
//   3. Post-DNS IP blocklist: resolve the host to an IP, reject if the IP
//      lands in RFC 1918, link-local (incl. AWS/GCP/Azure metadata 169.254.0.0/16),
//      loopback, IPv6 ULA, or IPv6 link-local. `allowPrivateNetworks: true`
//      bypasses this for self-hosted scenarios with a startup warning.
//
// The IP is checked but NOT pinned into the actual fetch in v1.2 OSS — under
// undici this requires a custom Dispatcher and is left for v1.2.x. The
// OS-level resolver typically reuses the same IP for the immediately-following
// fetch, so in practice this catches direct attacks; targeted DNS-rebinding
// against a tight time window is the documented residual risk.

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
  // Link-local incl. AWS/GCP/Azure metadata 169.254.169.254
  { net: ipv4ToInt('169.254.0.0'), mask: 0xffff0000 },
  // 0.0.0.0/8
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

export function isPrivateIPv4(ip: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const v = ipv4ToInt(ip);
  // `&` truncates to int32 (signed); `>>> 0` reinterprets as unsigned so the
  // comparison against `b.net` (always unsigned) is correct.
  return PRIVATE_IPV4_BLOCKS.some((b) => (v & b.mask) >>> 0 === b.net);
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6
    const v4 = lower.slice('::ffff:'.length);
    return isPrivateIPv4(v4);
  }
  return false;
}

const FORBIDDEN_METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.azure.com', 'metadata.aws.com']);

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

  if (outbound.allowPrivateNetworks) {
    return { ok: true };
  }

  // Resolve to IP and check blocklist. dns.lookup respects the OS resolver
  // (which honors /etc/hosts and other configured resolvers). `node:dns` is
  // imported lazily here — only when private-network checks are enabled — so a
  // V8-isolate runtime (Cloudflare Worker), where `node:dns` may be absent and
  // egress is already sandboxed, never loads it at module-eval. Set
  // `outbound.allowPrivateNetworks: true` on such runtimes to skip this entirely.
  let addresses;
  try {
    const { promises: dns } = await import('node:dns');
    addresses = await dns.lookup(hostname, { all: true });
  } catch (e) {
    return { ok: false, reason: `DNS resolution failed for "${hostname}": ${(e as Error).message}` };
  }

  for (const a of addresses) {
    if (a.family === 4 && isPrivateIPv4(a.address)) {
      return { ok: false, reason: `host "${hostname}" resolved to private/loopback IPv4 ${a.address}` };
    }
    if (a.family === 6 && isPrivateIPv6(a.address)) {
      return { ok: false, reason: `host "${hostname}" resolved to private IPv6 ${a.address}` };
    }
  }

  return { ok: true };
}
