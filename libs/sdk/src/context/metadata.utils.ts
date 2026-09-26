/**
 * Metadata Utilities
 *
 * Shared utilities for extracting request metadata from HTTP headers.
 */

import { isProxyTrusted } from '../common/utils/path.utils';
import type { RequestMetadata } from './frontmcp-context';

/** Where the client IP may legitimately come from, beyond the headers. */
export interface ClientIpOptions {
  /** Socket peer address, e.g. `req.socket.remoteAddress`. The only unforgeable source. */
  peerAddress?: string;
  /** Overrides the `FRONTMCP_TRUST_PROXY` environment default. */
  trustProxy?: boolean;
  /** Overrides the `FRONTMCP_TRUSTED_PROXY_DEPTH` environment default. */
  trustedProxyDepth?: number;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_ZONE_ID_PATTERN = /^[A-Za-z0-9_.~-]+$/;

function isIpv4(value: string): boolean {
  const match = IPV4_PATTERN.exec(value);
  if (!match) return false;
  return match.slice(1).every((octet) => {
    // Reject leading zeros: `0177.0.0.1` is octal in some resolvers and decimal here.
    if (octet.length > 1 && octet.startsWith('0')) return false;
    return Number(octet) <= 255;
  });
}

/**
 * Whether `value` is a well-formed IPv6 address.
 *
 * Parses rather than pattern-matches. A character-class-and-count heuristic accepts `:`,
 * `1:2:3`, `1::2::3` and `::ffff:999.999.999.999`, and this value becomes a rate-limit and
 * IP-filter identity — so a malformed one is a key an attacker chose.
 */
function isIpv6(value: string): boolean {
  const zoneStart = value.indexOf('%');
  // A zone id names a local interface (RFC 6874). It is kept, so it must not smuggle a delimiter.
  if (zoneStart !== -1 && !IPV6_ZONE_ID_PATTERN.test(value.slice(zoneStart + 1))) return false;
  const text = zoneStart === -1 ? value : value.slice(0, zoneStart);
  if (text.length === 0) return false;

  let head = text;
  let embedded = 0;

  // A trailing dotted-quad stands for the last two groups and must be a valid IPv4.
  const lastColon = head.lastIndexOf(':');
  const tail = lastColon === -1 ? '' : head.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIpv4(tail)) return false;
    const groupsBeforeQuad = head.slice(0, lastColon + 1);
    head = groupsBeforeQuad.endsWith('::') ? groupsBeforeQuad : groupsBeforeQuad.slice(0, -1);
    embedded = 2;
  }

  const halves = head.split('::');
  if (halves.length > 2) return false;

  const countGroups = (part: string): number | null => {
    if (part === '') return 0;
    const groups = part.split(':');
    for (const group of groups) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(group)) return null;
    }
    return groups.length;
  };

  const headCount = countGroups(halves[0]);
  if (headCount === null) return false;

  if (halves.length === 1) {
    return headCount + embedded === 8;
  }

  const tailCount = countGroups(halves[1]);
  if (tailCount === null) return false;

  // `::` stands for at least one group of zeros.
  return headCount + tailCount + embedded <= 7;
}

/**
 * Whether `value` is an IP address we are willing to key on.
 *
 * A forwarded header is free text. Without this check a caller can send
 * `x-forwarded-for: <anything>` and mint an arbitrary rate-limit bucket, or smuggle a
 * delimiter into a storage key built from it.
 */
function isIpAddress(value: string): boolean {
  const candidate = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return candidate.includes(':') ? isIpv6(candidate) : isIpv4(candidate);
}

function normalizeIp(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return isIpAddress(trimmed) ? trimmed : undefined;
}

function readTrustedProxyDepth(): number {
  try {
    if (typeof process !== 'undefined' && process.env) {
      const parsed = Number(process.env['FRONTMCP_TRUSTED_PROXY_DEPTH']);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // No process env — fall through to the default.
  }
  return 1;
}

/** A depth is only usable if it is a positive integer, however it was supplied. */
function normalizeDepth(depth: number | undefined): number {
  if (depth === undefined) return readTrustedProxyDepth();
  return Number.isInteger(depth) && depth > 0 ? depth : readTrustedProxyDepth();
}

function headerValues(header: unknown): string[] {
  if (typeof header === 'string') return header.split(',');
  if (Array.isArray(header)) {
    return header.filter((entry): entry is string => typeof entry === 'string').flatMap((entry) => entry.split(','));
  }
  return [];
}

/**
 * Extract request metadata from headers.
 *
 * @param headers - HTTP headers object
 * @param options - Socket peer address and proxy-trust overrides
 * @returns Extracted metadata including user-agent, content-type, client IP, and custom headers
 */
export function extractMetadata(headers: Record<string, unknown>, options?: ClientIpOptions): RequestMetadata {
  const customHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase().startsWith('x-frontmcp-') && typeof value === 'string') {
      customHeaders[key.toLowerCase()] = value;
    }
  }

  return {
    userAgent: typeof headers['user-agent'] === 'string' ? headers['user-agent'] : undefined,
    contentType: typeof headers['content-type'] === 'string' ? headers['content-type'] : undefined,
    accept: typeof headers['accept'] === 'string' ? headers['accept'] : undefined,
    clientIp: extractClientIp(headers, options),
    customHeaders,
  };
}

/**
 * Extract the client IP for a request (GHSA-p3qf-fcwm-35x4).
 *
 * `x-forwarded-for` and `x-real-ip` are claims made by whoever sent the request. Anything
 * that reaches the app directly can set them, so they are honoured ONLY when a reverse proxy
 * is declared trusted — via `FRONTMCP_TRUST_PROXY`, the same switch that already gates
 * `x-forwarded-proto`/`x-forwarded-host` in `getRequestBaseUrl`. Otherwise the socket peer is
 * the only honest answer.
 *
 * When a proxy IS trusted, the client is taken from the TRUSTED end of the chain:
 * `x-forwarded-for` is append-only, so a caller controls the left of the list and our own
 * proxies appended to the right. `FRONTMCP_TRUSTED_PROXY_DEPTH` (default 1) says how many
 * hops we appended; the entry just before them is the furthest one we can still vouch for.
 * Reading the leftmost entry, as this did, reads exactly the part the caller controls.
 *
 * The result is always validated as an IP, so a forged header cannot mint an arbitrary
 * rate-limit bucket or smuggle a delimiter into a key built from it.
 *
 * @param headers - HTTP headers object
 * @param options - Socket peer address and proxy-trust overrides
 * @returns Client IP address or undefined when none can be established
 */
export function extractClientIp(headers: Record<string, unknown>, options?: ClientIpOptions): string | undefined {
  const peerIp = normalizeIp(options?.peerAddress);
  const trustProxy = options?.trustProxy ?? isProxyTrusted();

  if (!trustProxy) {
    return peerIp;
  }

  const depth = normalizeDepth(options?.trustedProxyDepth);
  const forwarded = headerValues(headers['x-forwarded-for'])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (forwarded.length > 0) {
    // A chain SHORTER than the configured depth was not built by our proxies, so none of its
    // entries is vouched for. Return the peer rather than falling through — `x-real-ip` is
    // just as caller-settable, so consulting it here would hand back a value the caller chose
    // and undo the check above.
    if (forwarded.length < depth) return peerIp;

    // Count back past the hops our own proxies appended.
    return normalizeIp(forwarded[forwarded.length - depth]) ?? peerIp;
  }

  // No forwarded chain at all. `x-real-ip` is the single value a one-hop proxy (nginx and
  // friends) sets instead of a chain; beyond one hop there is no way to tell which hop set
  // it, so it is not usable as the trusted end.
  if (depth === 1) {
    const realIp = normalizeIp(headerValues(headers['x-real-ip'])[0]);
    if (realIp) return realIp;
  }

  return peerIp;
}
