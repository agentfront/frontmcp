/**
 * The same-origin check `@HttpRoute` mutations go through (POST, PUT, PATCH, DELETE), with the Origin rules the
 * loopback DNS-rebinding protection applies: the server's own origin under any loopback spelling of its port, and the
 * origins the server lists. A request with neither `Origin` nor `Sec-Fetch-Site` comes from a non-browser client and
 * is allowed; a browser sends at least one of them on every mutation.
 */
import { normalizeHost, normalizeOrigin } from './host-validation';
import { isLoopbackAddress } from './resolve-allowed-hosts';

type HeaderValue = string | string[] | undefined;

function first(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isLoopbackAlias(origin: URL, hostHeader: string | undefined): boolean {
  const host = hostHeader ? parseUrl(`http://${hostHeader}`) : undefined;
  return (
    host !== undefined &&
    isLoopbackAddress(origin.hostname) &&
    isLoopbackAddress(host.hostname) &&
    origin.port === host.port
  );
}

/**
 * Whether a browser request comes from the server's own pages.
 *
 * @param headers - the request's headers, lowercase names
 * @param allowedOrigins - more origins to accept, such as the explicit `http.cors.origin` list
 * @param trustForwardedHost - count `X-Forwarded-Host` as the server's own host; only behind a trusted proxy, since a
 *   page can send the header itself when CORS lets it
 */
export function isSameOriginRequest(
  headers: Readonly<Record<string, HeaderValue>>,
  allowedOrigins: readonly string[] = [],
  trustForwardedHost = false,
): boolean {
  const originHeader = first(headers['origin']);
  if (originHeader !== undefined) {
    const normalized = normalizeOrigin(originHeader);
    if (allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalized)) return true;
    const origin = parseUrl(originHeader);
    if (!origin || origin.origin === 'null') return false;
    const host = first(headers['host']);
    const forwardedHosts = trustForwardedHost ? (first(headers['x-forwarded-host'])?.split(',') ?? []) : [];
    const ownHosts = [host, ...forwardedHosts]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .map(normalizeHost);
    if (!ownHosts.includes(normalizeHost(origin.host))) return isLoopbackAlias(origin, host);
  }
  const site = first(headers['sec-fetch-site']);
  return site === undefined || site === 'same-origin' || site === 'none';
}
