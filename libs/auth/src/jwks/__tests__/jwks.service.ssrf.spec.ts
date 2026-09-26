/**
 * Provider JWKS and discovery fetches refuse internal destinations (GHSA-xx4w-33pp-cmw4).
 *
 * `JwksService` fetches the configured `jwksUri`, the issuer's `.well-known` metadata and any
 * `jwks_uri` that metadata names, following redirects by hand. Every one of those URLs must pass
 * the same SSRF guard as CIMD, in every IPv6 spelling, on the first request and on each hop.
 */
import * as dns from 'node:dns';

import { JwksService } from '../jwks.service';

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const mockDnsLookup = dns.promises.lookup as unknown as jest.Mock;

type FetchJson = { fetchJson(url: string): Promise<unknown> };

describe('JwksService — SSRF on JWKS and discovery fetches (GHSA-xx4w-33pp-cmw4)', () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch');
    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it.each([
    'https://[::ffff:a9fe:a9fe]',
    'https://[::ffff:0:a9fe:a9fe]',
    'https://[64:ff9b:1::a9fe:a9fe]',
    'https://[2002:a9fe:a9fe::]',
    'https://[::ffff:7f00:1]:8443',
  ])('never fetches a JWKS or discovery document from %s', async (origin) => {
    const service = new JwksService();

    const jwks = await service.getJwksForProvider({
      id: 'idp',
      issuerUrl: origin,
      jwksUri: `${origin}/.well-known/jwks.json`,
    });

    expect(jwks).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a redirect from a public IdP to an IPv6-literal metadata address', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'https://[::ffff:a9fe:a9fe]/latest/meta-data/' }),
    } as unknown as Response);
    const service = new JwksService();

    const jwks = await service.getJwksForProvider({
      id: 'idp',
      issuerUrl: 'https://idp.example.com',
      jwksUri: 'https://idp.example.com/.well-known/jwks.json',
    });

    expect(jwks).toBeUndefined();
    const requestedHosts = mockFetch.mock.calls.map(([url]) => new URL(String(url)).hostname);
    expect(requestedHosts.length).toBeGreaterThan(0);
    expect(requestedHosts.every((host) => host === 'idp.example.com')).toBe(true);
  });

  it('refuses an opaque redirect (status 0, browser runtimes) as a redirect', async () => {
    mockFetch.mockResolvedValue({
      type: 'opaqueredirect',
      ok: false,
      status: 0,
      headers: new Headers(),
    } as unknown as Response);
    const service = new JwksService() as unknown as FetchJson;

    await expect(service.fetchJson('https://idp.example.com/.well-known/jwks.json')).rejects.toThrow(/redirect/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
