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

/**
 * Whether `value` is an IP address we are willing to key on.
 *
 * A forwarded header is free text. Without this check a caller can send
 * `x-forwarded-for: <anything>` and mint an arbitrary rate-limit bucket, or smuggle a
 * delimiter into a storage key built from it.
 */
function isIpAddress(value: string): boolean {
  const candidate = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;

  const ipv4 = IPV4_PATTERN.exec(candidate);
  if (ipv4) {
    return ipv4.slice(1).every((octet) => octet.length <= 3 && Number(octet) <= 255);
  }

  // IPv6, including the IPv4-mapped `::ffff:1.2.3.4` form.
  if (!candidate.includes(':')) return false;
  if (!/^[0-9A-Fa-f:.]+$/.test(candidate)) return false;
  const embeddedIpv4 = candidate.slice(candidate.lastIndexOf(':') + 1);
  if (embeddedIpv4.includes('.') && !IPV4_PATTERN.test(embeddedIpv4)) return false;
  return candidate.split(':').length <= 9;
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

  const depth = options?.trustedProxyDepth ?? readTrustedProxyDepth();
  const forwarded = headerValues(headers['x-forwarded-for'])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (forwarded.length > 0) {
    // Count back past the hops we appended ourselves; clamp so a short chain still yields
    // its leftmost entry rather than nothing.
    const index = Math.max(0, forwarded.length - depth);
    const candidate = normalizeIp(forwarded[index]);
    if (candidate) return candidate;
  }

  const realIp = normalizeIp(headerValues(headers['x-real-ip'])[0]);
  if (realIp) return realIp;

  return peerIp;
}
