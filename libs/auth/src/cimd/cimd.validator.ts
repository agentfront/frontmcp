/**
 * CIMD URL Validator with SSRF Protection
 *
 * Validates client_id URLs per CIMD specification and provides
 * Server-Side Request Forgery (SSRF) protection.
 */
import { InvalidClientIdUrlError, CimdSecurityError } from './cimd.errors';
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

  // Link-local: 169.254.0.0/16
  if (a === 169 && b === 254) {
    return { allowed: false, reason: 'Link-local addresses (169.254.x.x) are not allowed' };
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
function checkIpv6(ip: string): SsrfCheckResult {
  const normalizedIp = ip.toLowerCase();

  // Loopback: ::1
  if (normalizedIp === '::1') {
    return { allowed: false, reason: 'IPv6 loopback address (::1) is not allowed' };
  }

  // Unspecified: ::
  if (normalizedIp === '::' || normalizedIp === '0:0:0:0:0:0:0:0') {
    return { allowed: false, reason: 'IPv6 unspecified address (::) is not allowed' };
  }

  // Link-local: fe80::/10
  if (
    normalizedIp.startsWith('fe8') ||
    normalizedIp.startsWith('fe9') ||
    normalizedIp.startsWith('fea') ||
    normalizedIp.startsWith('feb')
  ) {
    return { allowed: false, reason: 'IPv6 link-local addresses (fe80::/10) are not allowed' };
  }

  // Unique local: fc00::/7 (fc00::/8 and fd00::/8)
  if (normalizedIp.startsWith('fc') || normalizedIp.startsWith('fd')) {
    return { allowed: false, reason: 'IPv6 unique local addresses (fc00::/7) are not allowed' };
  }

  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  const ipv4MappedMatch = normalizedIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedMatch) {
    return checkIpv4(ipv4MappedMatch[1]);
  }

  return { allowed: true, reason: '' };
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
