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
//      (fe80::/10), the AWS IMDSv6 literal fd00:ec2::254 and the unspecified
//      addresses are blocked even for self-hosted deployments — there is no
//      legitimate upstream there, and it is the prime SSRF target
//      (SECURITY-REVIEW B2/B4).
//   4. Non-public blocklist (RFC 1918, loopback, CGNAT 100.64.0.0/10, IPv6
//      ULA/site-local, multicast, reserved, benchmarking): applied to both
//      IP-literal hosts and resolved names UNLESS `allowPrivateNetworks: true`.
//
// IP-literal hosts (e.g. `http://169.254.169.254/`, `http://[fd00:ec2::254]/`)
// are validated DIRECTLY without DNS — so the metadata/private checks apply on
// every runtime, including V8 isolates where `node:dns` is absent.
//
// SECURITY (GHSA-4r57-gvgj-5crm): addresses are classified by `@frontmcp/utils`
// on their parsed value, never their spelling. WHATWG URL canonicalises
// `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, and IPv6 has further
// forms that carry an IPv4 address (translated, compatible, NAT64, 6to4); each
// is judged by the IPv4 address it reaches.
//
// The IP is checked but NOT pinned into the actual fetch in v1.2 OSS — under
// undici this requires a custom Dispatcher and is left for v1.2.x. The
// OS-level resolver typically reuses the same IP for the immediately-following
// fetch, so in practice this catches direct attacks; targeted DNS-rebinding
// against a tight time window is the documented residual risk (B5).

import { classifyIpAddress, parseIpv4, type IpAddressClassification, type IpAddressRange } from '@frontmcp/utils';

import type { OutboundOptions } from '../skilled-openapi.types';

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
}

// ALWAYS forbidden, regardless of `allowPrivateNetworks`. These ranges host
// cloud instance-metadata services (IMDS) and link-local addresses that no
// legitimate upstream API uses — allowing them would re-open the prime SSRF
// target even on self-hosted deployments that legitimately reach RFC 1918.
const ALWAYS_FORBIDDEN_RANGES: ReadonlySet<IpAddressRange> = new Set<IpAddressRange>([
  'link-local',
  'cloud-metadata',
  'unspecified',
  'this-network',
  'local-use-nat64',
]);

interface AddressViolation {
  description: string;
  alwaysForbidden: boolean;
}

function classifyFamily(ip: string, family: 4 | 6): IpAddressClassification | undefined {
  const classification = classifyIpAddress(ip);
  return classification?.family === family ? classification : undefined;
}

export function isPrivateIPv4(ip: string): boolean {
  // "Private" is every non-public range, the always-forbidden ones included.
  const classification = classifyFamily(ip, 4);
  return classification !== undefined && classification.range !== 'public';
}

/** Metadata / link-local IPv4 — blocked even when `allowPrivateNetworks` is on. */
export function isAlwaysForbiddenIPv4(ip: string): boolean {
  const classification = classifyFamily(ip, 4);
  return classification !== undefined && ALWAYS_FORBIDDEN_RANGES.has(classification.range);
}

export function isPrivateIPv6(ip: string): boolean {
  const classification = classifyFamily(ip, 6);
  return classification !== undefined && classification.range !== 'public';
}

/** Metadata / link-local IPv6 (including IPv4-carrying forms) — blocked even when `allowPrivateNetworks` is on. */
export function isAlwaysForbiddenIPv6(ip: string): boolean {
  const classification = classifyFamily(ip, 6);
  return classification !== undefined && ALWAYS_FORBIDDEN_RANGES.has(classification.range);
}

/** Why an IP address may not be contacted, or undefined when it may. Unparseable addresses are refused. */
function findAddressViolation(address: string, outbound: OutboundOptions): AddressViolation | undefined {
  const classification = classifyIpAddress(address);
  if (!classification) {
    return { description: `malformed IP address ${address}`, alwaysForbidden: true };
  }
  if (classification.range === 'public') return undefined;

  const alwaysForbidden = ALWAYS_FORBIDDEN_RANGES.has(classification.range);
  if (!alwaysForbidden && outbound.allowPrivateNetworks) return undefined;

  const category = alwaysForbidden ? 'metadata/link-local' : 'private/loopback';
  const embedded = classification.embeddedIpv4 ? `embeds ${classification.embeddedIpv4}, ` : '';
  return {
    description: `${category} IPv${classification.family} ${address} (${embedded}in ${classification.cidr})`,
    alwaysForbidden,
  };
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
function classifyHostLiteral(hostname: string): { isIpLiteral: boolean; address: string } {
  const address = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  // An IPv6 literal contains a colon; a DNS name never does.
  return { isIpLiteral: parseIpv4(address) !== undefined || address.includes(':'), address };
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
  if (literal.isIpLiteral) {
    const violation = findAddressViolation(literal.address, outbound);
    if (violation) {
      return { ok: false, reason: `${violation.description} is ${violation.alwaysForbidden ? 'always ' : ''}blocked` };
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
    addresses = await dns.lookup(literal.address, { all: true });
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

  for (const { address } of addresses) {
    const violation = findAddressViolation(address, outbound);
    if (violation) {
      return { ok: false, reason: `host "${hostname}" resolved to ${violation.description}` };
    }
  }

  return { ok: true };
}
