/**
 * CIMD URL Validator with SSRF Protection
 *
 * Validates client_id URLs per CIMD specification and provides
 * Server-Side Request Forgery (SSRF) protection.
 */
import { CimdSecurityError, InvalidClientIdUrlError } from './cimd.errors';
import type { CimdSecurityConfig } from './cimd.types';

/**
 * Check if a client_id is a CIMD URL (HTTPS URL with path component).
 *
 * Per CIMD spec, a CIMD client_id is an HTTPS URL that:
 * - Uses the https:// scheme
 * - Has a path component (not just the root)
 *
 * @param clientId - The client_id to check
 * @param allowInsecure - Allow HTTP for localhost (testing only)
 * @returns true if this is a CIMD client_id
 */
export function isCimdClientId(clientId: string, allowInsecure = false): boolean {
  if (!clientId || typeof clientId !== 'string') {
    return false;
  }

  try {
    const url = new URL(clientId);

    // Must be HTTPS (or HTTP if allowInsecure is true for localhost)
    if (url.protocol === 'https:') {
      // HTTPS is always allowed
    } else if (url.protocol === 'http:' && allowInsecure && isLocalhostHost(url.hostname)) {
      // HTTP allowed for localhost when testing
    } else {
      return false;
    }

    // Must have a path component (not just '/')
    // Per CIMD spec, the URL must have a path to distinguish from regular OAuth client IDs
    if (!url.pathname || url.pathname === '/') {
      return false;
    }

    return true;
  } catch {
    // Not a valid URL
    return false;
  }
}

/**
 * Check if a hostname is localhost or a loopback address.
 */
function isLocalhostHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]' || lower.endsWith('.localhost');
}

/**
 * Validate a client_id URL for CIMD usage.
 *
 * @param clientId - The client_id to validate
 * @param securityConfig - Optional security configuration
 * @returns The parsed URL object
 * @throws InvalidClientIdUrlError if the URL is invalid
 * @throws CimdSecurityError if the URL violates security policy
 */
export function validateClientIdUrl(clientId: string, securityConfig?: Partial<CimdSecurityConfig>): URL {
  if (!clientId || typeof clientId !== 'string') {
    throw new InvalidClientIdUrlError(clientId || '', 'client_id must be a non-empty string');
  }

  // Parse the URL
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new InvalidClientIdUrlError(clientId, 'Invalid URL format');
  }

  const allowInsecure = securityConfig?.allowInsecureForTesting ?? false;

  // Must be HTTPS (or HTTP for localhost if allowInsecure is true)
  if (url.protocol === 'https:') {
    // HTTPS is always allowed
  } else if (url.protocol === 'http:' && allowInsecure && isLocalhostHost(url.hostname)) {
    // HTTP allowed for localhost when testing
  } else {
    throw new InvalidClientIdUrlError(clientId, `CIMD requires HTTPS, got ${url.protocol.replace(':', '')}`);
  }

  // Must have a path component (not just '/')
  if (!url.pathname || url.pathname === '/') {
    throw new InvalidClientIdUrlError(
      clientId,
      'CIMD client_id URL must have a path component (e.g., /oauth/client-metadata.json)',
    );
  }

  // Security checks
  const config = {
    blockPrivateIPs: securityConfig?.blockPrivateIPs ?? true,
    allowedDomains: securityConfig?.allowedDomains,
    blockedDomains: securityConfig?.blockedDomains,
  };

  // Check domain allow/block lists
  if (config.allowedDomains?.length) {
    if (!isDomainInList(url.hostname, config.allowedDomains)) {
      throw new CimdSecurityError(clientId, `Domain "${url.hostname}" is not in the allowed domains list`);
    }
  }

  if (config.blockedDomains?.length) {
    if (isDomainInList(url.hostname, config.blockedDomains)) {
      throw new CimdSecurityError(clientId, `Domain "${url.hostname}" is blocked`);
    }
  }

  // SSRF protection: block private/internal IPs (but allow localhost when testing)
  if (config.blockPrivateIPs && !allowInsecure) {
    const ssrfCheck = checkSsrfProtection(url.hostname);
    if (!ssrfCheck.allowed) {
      throw new CimdSecurityError(clientId, ssrfCheck.reason);
    }
  }

  return url;
}

/**
 * Check if a hostname should be blocked for SSRF protection.
 */
interface SsrfCheckResult {
  allowed: boolean;
  reason: string;
}

/**
 * Perform SSRF protection checks on a hostname.
 *
 * @param hostname - The hostname to check
 * @returns Result indicating if the hostname is allowed
 */
export function checkSsrfProtection(hostname: string): SsrfCheckResult {
  const lowercaseHostname = hostname.toLowerCase();

  // Block localhost and loopback
  if (
    lowercaseHostname === 'localhost' ||
    lowercaseHostname === 'localhost.localdomain' ||
    lowercaseHostname.endsWith('.localhost')
  ) {
    return { allowed: false, reason: 'Localhost addresses are not allowed' };
  }

  // Check if it's an IP address
  if (isIpAddress(hostname)) {
    const ipCheck = checkIpAddress(hostname);
    if (!ipCheck.allowed) {
      return ipCheck;
    }
  }

  return { allowed: true, reason: '' };
}

/**
 * Resolve a hostname via DNS and validate EVERY resolved address against the
 * private/reserved-range blocklist — the DNS-aware complement to
 * {@link checkSsrfProtection}.
 *
 * SECURITY (SSRF): `checkSsrfProtection` alone only inspects literal-IP and
 * localhost-string hostnames; a hostname like `metadata.attacker.example` whose
 * A-record points at `169.254.169.254` / `10.x` / `127.x` passes it untouched
 * and the subsequent `fetch()` then connects to the internal address. This
 * function closes that gap by resolving the name and rejecting if ANY resolved
 * address is internal.
 *
 * Residual risk (documented, not yet closed here): DNS rebinding — the resolver
 * used here and the resolver used by `fetch()` are distinct, so a TOCTOU
 * attacker could return a public IP to this check and an internal IP to the
 * fetch. Fully closing it requires pinning the socket to the validated IP
 * (custom undici `lookup`/dispatcher), which is left to the caller/runtime.
 *
 * Degrades gracefully when `node:dns` is unavailable (e.g. a V8-isolate runtime)
 * or the name fails to resolve: an unresolvable name cannot be reached by
 * `fetch()` either, so we fall back to the literal-IP checks that already ran.
 */
export async function resolveAndCheckHostname(hostname: string): Promise<SsrfCheckResult> {
  // Fast path: literal-IP + localhost-string checks (no DNS required).
  const literal = checkSsrfProtection(hostname);
  if (!literal.allowed) return literal;

  // A literal IP was already authoritatively checked above — nothing to resolve.
  if (isIpAddress(hostname)) return { allowed: true, reason: '' };

  // Lazy require so browser/worker bundles never eagerly pull in node:dns.
  let dns: typeof import('node:dns');
  try {
    dns = require('node:dns') as typeof import('node:dns');
  } catch {
    // node:dns is unavailable (non-Node runtime, e.g. a V8-isolate Worker). We
    // cannot resolve to validate, so degrade to the literal-IP checks already
    // performed and rely on the runtime's own egress controls.
    return { allowed: true, reason: '' };
  }

  let addresses: Array<{ address: string }>;
  try {
    const result = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    addresses = Array.isArray(result) ? result : [result as unknown as { address: string }];
  } catch {
    // node:dns IS available but resolution failed. Fail CLOSED: a transient
    // lookup failure here does NOT prove the host is unreachable — the fetch()
    // performs its own DNS resolution and could still connect to a private
    // address, so refuse to fetch an unvalidated destination.
    return { allowed: false, reason: `DNS resolution failed for "${hostname}"; refusing to fetch an unvalidated host` };
  }

  // An empty resolution means we validated nothing — fail closed rather than
  // letting the subsequent fetch() resolve the name unchecked.
  if (addresses.length === 0) {
    return { allowed: false, reason: `Host "${hostname}" resolved to no addresses` };
  }

  for (const { address } of addresses) {
    if (!address) continue;
    const ipCheck = checkIpAddress(address);
    if (!ipCheck.allowed) {
      return {
        allowed: false,
        reason: `Host "${hostname}" resolves to a blocked address (${address}): ${ipCheck.reason}`,
      };
    }
  }
  return { allowed: true, reason: '' };
}

/**
 * Throwing wrapper around {@link resolveAndCheckHostname} for CIMD fetch paths.
 * Must be called immediately before each outbound `fetch` (initial URL AND every
 * redirect hop) so an attacker-supplied `client_id` host cannot resolve to an
 * internal address.
 *
 * @throws CimdSecurityError if the host (or any resolved address) is internal.
 */
export async function assertHostNotSsrf(hostname: string, clientId: string): Promise<void> {
  const check = await resolveAndCheckHostname(hostname);
  if (!check.allowed) {
    throw new CimdSecurityError(clientId, check.reason);
  }
}

/**
 * Check if a string is an IP address (IPv4 or IPv6).
 */
function isIpAddress(hostname: string): boolean {
  // IPv4 pattern: n.n.n.n
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(hostname)) {
    return true;
  }

  // IPv6 pattern: contains colons (simplified check)
  // Handle bracketed IPv6 (e.g., [::1])
  const cleanHostname = hostname.replace(/^\[|\]$/g, '');
  if (cleanHostname.includes(':')) {
    return true;
  }

  return false;
}

/**
 * Check if an IP address is private/internal.
 */
function checkIpAddress(ip: string): SsrfCheckResult {
  // Handle bracketed IPv6
  const cleanIp = ip.replace(/^\[|\]$/g, '');

  // Check IPv4
  if (cleanIp.includes('.') && !cleanIp.includes(':')) {
    return checkIpv4(cleanIp);
  }

  // Check IPv6
  return checkIpv6(cleanIp);
}

/**
 * Check if an IPv4 address is private/internal.
 */
function checkIpv4(ip: string): SsrfCheckResult {
  const parts = ip.split('.').map(Number);

  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return { allowed: false, reason: 'Invalid IPv4 address' };
  }

  const [a, b, c, d] = parts;

  // Loopback: 127.0.0.0/8
  if (a === 127) {
    return { allowed: false, reason: 'Loopback addresses (127.x.x.x) are not allowed' };
  }

  // Private Class A: 10.0.0.0/8
  if (a === 10) {
    return { allowed: false, reason: 'Private IP addresses (10.x.x.x) are not allowed' };
  }

  // Private Class B: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) {
    return { allowed: false, reason: 'Private IP addresses (172.16-31.x.x) are not allowed' };
  }

  // Private Class C: 192.168.0.0/16
  if (a === 192 && b === 168) {
    return { allowed: false, reason: 'Private IP addresses (192.168.x.x) are not allowed' };
  }

  // Link-local: 169.254.0.0/16 (includes cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) {
    return { allowed: false, reason: 'Link-local addresses (169.254.x.x) are not allowed' };
  }

  // Carrier-grade NAT: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) {
    return { allowed: false, reason: 'Carrier-grade NAT addresses (100.64-127.x.x) are not allowed' };
  }

  // IETF protocol assignments / benchmarking / TEST-NET blocks that commonly
  // front internal infrastructure.
  if (a === 192 && b === 0 && c === 0) {
    return { allowed: false, reason: 'IETF protocol-assignment addresses (192.0.0.0/24) are not allowed' };
  }

  // Current network (0.0.0.0/8)
  if (a === 0) {
    return { allowed: false, reason: 'Current network addresses (0.x.x.x) are not allowed' };
  }

  // Broadcast (255.255.255.255)
  if (a === 255 && b === 255 && c === 255 && d === 255) {
    return { allowed: false, reason: 'Broadcast address is not allowed' };
  }

  // Multicast (224.0.0.0/4)
  if (a >= 224 && a <= 239) {
    return { allowed: false, reason: 'Multicast addresses are not allowed' };
  }

  return { allowed: true, reason: '' };
}

/**
 * Check if an IPv6 address is private/internal.
 */
/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * SECURITY (GHSA-xx4w-33pp-cmw4): the checks below used to run against the address as
 * written, so they only recognised one spelling of each blocked range. IPv6 has several
 * equivalent spellings of the same address — `::ffff:7f00:1`, `::ffff:127.0.0.1` and
 * `0:0:0:0:0:ffff:127.0.0.1` are all `127.0.0.1` — and matching on the text meant the other
 * spellings walked past the guard. Normalising first is what makes the range checks mean
 * what they say.
 *
 * @returns Eight group values, or null when the input is not a well-formed IPv6 address.
 */
function expandIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  if (text.includes('%')) {
    text = text.slice(0, text.indexOf('%'));
  }

  // A trailing dotted-quad stands for the last two groups.
  const dottedQuad = text.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedQuad) {
    const octets = dottedQuad[2].split('.').map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${dottedQuad[1]}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0]);
  if (head === null) return null;

  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  const tail = parseGroups(halves[1]);
  if (tail === null) return null;
  if (head.length + tail.length > 7) return null;

  return [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
}

function checkIpv6(ip: string): SsrfCheckResult {
  const groups = expandIpv6(ip);

  if (!groups) {
    // Not parseable as IPv6. Refuse rather than fall through to "allowed": an address this
    // guard cannot understand is not one it can vouch for.
    return { allowed: false, reason: `Malformed IPv6 address: ${ip}` };
  }

  const isZeroPrefix = groups.slice(0, 7).every((group) => group === 0);

  // Loopback: ::1
  if (isZeroPrefix && groups[7] === 1) {
    return { allowed: false, reason: 'IPv6 loopback address (::1) is not allowed' };
  }

  // Unspecified: ::
  if (isZeroPrefix && groups[7] === 0) {
    return { allowed: false, reason: 'IPv6 unspecified address (::) is not allowed' };
  }

  // Link-local: fe80::/10
  if ((groups[0] & 0xffc0) === 0xfe80) {
    return { allowed: false, reason: 'IPv6 link-local addresses (fe80::/10) are not allowed' };
  }

  // Unique local: fc00::/7
  if ((groups[0] & 0xfe00) === 0xfc00) {
    return { allowed: false, reason: 'IPv6 unique local addresses (fc00::/7) are not allowed' };
  }

  // Embedded IPv4, in every form that carries one: IPv4-mapped (::ffff:0:0/96),
  // IPv4-compatible (::/96, deprecated but still routed by some stacks), and the NAT64
  // well-known prefix (64:ff9b::/96). Each reaches an IPv4 destination, so each has to be
  // judged by the IPv4 rules rather than waved through.
  const embedded = extractEmbeddedIpv4(groups);
  if (embedded) {
    return checkIpv4(embedded);
  }

  return { allowed: true, reason: '' };
}

/**
 * The IPv4 address embedded in an IPv6 address, where there is one.
 */
function extractEmbeddedIpv4(groups: number[]): string | null {
  const toDotted = () => {
    const high = groups[6];
    const low = groups[7];
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  };

  const firstFive = groups.slice(0, 5).every((group) => group === 0);

  // ::ffff:a.b.c.d — IPv4-mapped
  if (firstFive && groups[5] === 0xffff) return toDotted();

  // ::a.b.c.d — IPv4-compatible. `::` and `::1` are handled above, so anything left here
  // with a non-zero high group is a real embedded address.
  if (firstFive && groups[5] === 0 && groups[6] !== 0) return toDotted();

  // 64:ff9b::a.b.c.d — NAT64 well-known prefix
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return toDotted();
  }

  return null;
}

/**
 * Check if a hostname matches a domain in the list.
 * Supports both exact matches and wildcard subdomains.
 */
function isDomainInList(hostname: string, domainList: string[]): boolean {
  const lowerHostname = hostname.toLowerCase();

  for (const domain of domainList) {
    const lowerDomain = domain.toLowerCase();

    // Exact match
    if (lowerHostname === lowerDomain) {
      return true;
    }

    // Subdomain match (e.g., "example.com" matches "sub.example.com")
    if (lowerHostname.endsWith('.' + lowerDomain)) {
      return true;
    }

    // Wildcard match (e.g., "*.example.com" matches "sub.example.com")
    if (lowerDomain.startsWith('*.')) {
      const baseDomain = lowerDomain.slice(2);
      if (lowerHostname === baseDomain || lowerHostname.endsWith('.' + baseDomain)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if any redirect URIs in the list are localhost-only.
 *
 * This is a warning indicator for development clients that might
 * have accidentally been submitted for production use.
 *
 * @param redirectUris - Array of redirect URIs to check
 * @returns true if all URIs are localhost
 */
export function hasOnlyLocalhostRedirectUris(redirectUris: string[]): boolean {
  if (!redirectUris.length) {
    return false;
  }

  return redirectUris.every((uri) => {
    try {
      const url = new URL(uri);
      const hostname = url.hostname.toLowerCase();
      return (
        hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')
      );
    } catch {
      return false;
    }
  });
}
