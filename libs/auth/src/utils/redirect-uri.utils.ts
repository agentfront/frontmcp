/**
 * Redirect-URI helpers shared by the authorization server flows.
 */

/**
 * Whether a redirect_uri targets the loopback interface (localhost, 127.0.0.0/8,
 * ::1) — the only hosts the default DCR guard accepts when no
 * `dcr.allowedRedirectUris` allowlist is configured.
 *
 * SECURITY: parses with `URL` and matches on the real `hostname`, replacing the
 * previous unanchored substring regex `^https?://(localhost|\d+\.\d+\.\d+\.\d+|127\.0\.0\.1)`
 * which accepted attacker hosts such as `http://localhost.evil.com/cb`,
 * `http://1.2.3.4.evil.com/cb`, and — via userinfo — `http://127.0.0.1@evil.com/cb`
 * (whose real host is `evil.com`). Any userinfo component is rejected outright.
 */
export function isLoopbackRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Reject `user:pass@host` — the authority host is what actually gets contacted.
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const octets = m.slice(1).map((n) => Number(n));
    return octets.every((o) => o >= 0 && o <= 255) && octets[0] === 127;
  }
  return false;
}
