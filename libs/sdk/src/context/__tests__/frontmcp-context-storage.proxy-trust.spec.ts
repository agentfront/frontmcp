/**
 * `throttle.ipFilter.trustProxy` reaches the context's client address (#766): with it, the
 * address comes from `X-Forwarded-For`, `trustedProxyDepth` hops back; without it, the socket peer
 * (unless `FRONTMCP_TRUST_PROXY` says otherwise).
 */
import { FrontMcpContextStorage } from '../frontmcp-context-storage';
import { proxyTrustOf } from '../metadata.utils';

const headers = { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' };

function clientIpWith(storage: FrontMcpContextStorage): string | undefined {
  return storage.runFromHeaders(
    headers,
    { sessionId: 's', scopeId: 'root', peerAddress: '10.0.0.1' },
    () => storage.getStore()?.metadata.clientIp,
  ) as string | undefined;
}

describe('FrontMcpContextStorage proxy trust', () => {
  const saved = process.env['FRONTMCP_TRUST_PROXY'];

  beforeEach(() => {
    delete process.env['FRONTMCP_TRUST_PROXY'];
  });

  afterAll(() => {
    if (saved === undefined) delete process.env['FRONTMCP_TRUST_PROXY'];
    else process.env['FRONTMCP_TRUST_PROXY'] = saved;
  });

  it('uses the socket peer without proxy trust', () => {
    expect(clientIpWith(new FrontMcpContextStorage())).toBe('10.0.0.1');
  });

  it('reads X-Forwarded-For, trustedProxyDepth hops back, when trustProxy is set', () => {
    expect(clientIpWith(new FrontMcpContextStorage().configure({}, { trustProxy: true }))).toBe('203.0.113.7');
    expect(clientIpWith(new FrontMcpContextStorage().configure({}, { trustProxy: true, trustedProxyDepth: 2 }))).toBe(
      '198.51.100.9',
    );
  });

  describe('from throttle.ipFilter', () => {
    const storageFor = (ipFilter: { trustProxy?: boolean; trustedProxyDepth?: number } | undefined) =>
      new FrontMcpContextStorage().configure({}, proxyTrustOf(ipFilter ? { ipFilter } : undefined));

    it('reads X-Forwarded-For, trustedProxyDepth hops back, for trustProxy: true', () => {
      expect(clientIpWith(storageFor({ trustProxy: true }))).toBe('203.0.113.7');
      expect(clientIpWith(storageFor({ trustProxy: true, trustedProxyDepth: 2 }))).toBe('198.51.100.9');
    });

    it('uses the socket peer for trustProxy: false, or no ipFilter, when the environment trusts no proxy', () => {
      expect(clientIpWith(storageFor({ trustProxy: false, trustedProxyDepth: 2 }))).toBe('10.0.0.1');
      expect(clientIpWith(storageFor(undefined))).toBe('10.0.0.1');
    });

    it('leaves FRONTMCP_TRUST_PROXY=true in charge for trustProxy: false', () => {
      process.env['FRONTMCP_TRUST_PROXY'] = 'true';

      expect(proxyTrustOf({ ipFilter: { trustProxy: false } })).toEqual({});
      expect(clientIpWith(storageFor({ trustProxy: false }))).toBe('203.0.113.7');
    });
  });
});
