/**
 * The client IP is only taken from forwarding headers when a proxy is trusted
 * (GHSA-p3qf-fcwm-35x4).
 *
 * `extractClientIp` read `x-forwarded-for` (first entry) and then `x-real-ip`, from headers
 * alone — no trust check, no socket peer address, no validation that the result is an IP at
 * all. `resolvePartitionKey` then used that value as the rate-limit bucket, which gave an
 * unauthenticated caller two ways through the limiter:
 *
 *  - send a different forged `x-forwarded-for` on every request and get a fresh bucket each
 *    time, so no limit is ever reached;
 *  - send none at all and land in the single shared `'unknown-ip'` bucket, exhausting it for
 *    every other client that also has no IP.
 *
 * A forwarding header is a claim by whoever sent the request. It counts only when a proxy in
 * front of us is declared trusted; otherwise the socket peer is the only honest answer.
 */
import { extractClientIp, extractMetadata } from '../metadata.utils';

describe('extractClientIp — proxy trust (GHSA-p3qf-fcwm-35x4)', () => {
  const originalTrustProxy = process.env['FRONTMCP_TRUST_PROXY'];
  const originalDepth = process.env['FRONTMCP_TRUSTED_PROXY_DEPTH'];

  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env['FRONTMCP_TRUST_PROXY'];
    else process.env['FRONTMCP_TRUST_PROXY'] = originalTrustProxy;
    if (originalDepth === undefined) delete process.env['FRONTMCP_TRUSTED_PROXY_DEPTH'];
    else process.env['FRONTMCP_TRUSTED_PROXY_DEPTH'] = originalDepth;
  });

  describe('with no trusted proxy (the default)', () => {
    beforeEach(() => {
      delete process.env['FRONTMCP_TRUST_PROXY'];
    });

    it('ignores a forged x-forwarded-for and uses the socket peer', () => {
      const ip = extractClientIp({ 'x-forwarded-for': '1.2.3.4' }, { peerAddress: '203.0.113.9' });

      expect(ip).toBe('203.0.113.9');
    });

    it('ignores a forged x-real-ip and uses the socket peer', () => {
      const ip = extractClientIp({ 'x-real-ip': '1.2.3.4' }, { peerAddress: '203.0.113.9' });

      expect(ip).toBe('203.0.113.9');
    });

    it('gives a rotating forged header no effect at all', () => {
      const seen = new Set(
        ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((forged) =>
          extractClientIp({ 'x-forwarded-for': forged }, { peerAddress: '203.0.113.9' }),
        ),
      );

      // One caller, one bucket — whatever it puts in the header.
      expect(seen).toEqual(new Set(['203.0.113.9']));
    });
  });

  describe('with a trusted proxy', () => {
    beforeEach(() => {
      process.env['FRONTMCP_TRUST_PROXY'] = 'true';
    });

    it('takes the client from the trusted end of the chain, not the caller-controlled end', () => {
      // A caller can prepend entries; only the rightmost hop was appended by our own proxy.
      const ip = extractClientIp({ 'x-forwarded-for': 'fake-1, fake-2, 198.51.100.7' }, { peerAddress: '10.0.0.1' });

      expect(ip).toBe('198.51.100.7');
    });

    it('honours a configured proxy depth', () => {
      process.env['FRONTMCP_TRUSTED_PROXY_DEPTH'] = '2';

      const ip = extractClientIp({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7, 10.0.0.2' }, { peerAddress: '10.0.0.1' });

      expect(ip).toBe('198.51.100.7');
    });

    it('falls back to the peer when the forwarded value is not an IP', () => {
      const ip = extractClientIp({ 'x-forwarded-for': 'not-an-ip' }, { peerAddress: '203.0.113.9' });

      expect(ip).toBe('203.0.113.9');
    });

    it('accepts an IPv6 forwarded address', () => {
      const ip = extractClientIp({ 'x-forwarded-for': '2001:db8::1' }, { peerAddress: '10.0.0.1' });

      expect(ip).toBe('2001:db8::1');
    });
  });

  it('rejects a peer address that is not a valid IP', () => {
    expect(extractClientIp({}, { peerAddress: 'garbage' })).toBeUndefined();
  });

  it('threads the peer address through extractMetadata', () => {
    delete process.env['FRONTMCP_TRUST_PROXY'];

    const metadata = extractMetadata({ 'x-forwarded-for': '1.2.3.4' }, { peerAddress: '203.0.113.9' });

    expect(metadata.clientIp).toBe('203.0.113.9');
  });
});
