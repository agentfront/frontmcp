/**
 * CIMD metadata fetches refuse IPv6-literal internal hosts end to end (GHSA-xx4w-33pp-cmw4).
 *
 * The validator tests prove the classifier; these prove the service never reaches `fetch` for an
 * IPv6-literal `client_id`, and never follows a redirect hop to one.
 */
import * as dns from 'node:dns';

import { CimdFetchError, CimdSecurityError } from '../cimd.errors';
import { CimdService } from '../cimd.service';

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const mockDnsLookup = dns.promises.lookup as unknown as jest.Mock;

function redirectTo(location: string): Response {
  return { ok: false, status: 302, headers: new Headers({ location }) } as unknown as Response;
}

describe('CimdService.resolveClientMetadata — IPv6-literal hosts (GHSA-xx4w-33pp-cmw4)', () => {
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
    'https://[::ffff:7f00:1]:18443/metadata.json',
    'https://[::ffff:0:7f00:1]:18443/metadata.json',
    'https://[64:ff9b:1::a9fe:a9fe]/metadata.json',
    'https://[2002:a9fe:a9fe::]/metadata.json',
  ])('refuses the client_id %s without fetching it', async (clientId) => {
    const service = new CimdService();

    await expect(service.resolveClientMetadata(clientId)).rejects.toBeInstanceOf(CimdSecurityError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['https://[::ffff:a9fe:a9fe]/metadata.json', 'https://[::ffff:0:a9fe:a9fe]/metadata.json'])(
    'refuses a redirect hop to %s',
    async (location) => {
      const service = new CimdService(undefined, { network: { redirectPolicy: 'allow' } });
      mockFetch.mockResolvedValueOnce(redirectTo(location));

      await expect(
        service.resolveClientMetadata('https://client.example.com/oauth/metadata.json'),
      ).rejects.toBeInstanceOf(CimdSecurityError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );
});

describe('CimdService.resolveClientMetadata — redirects the runtime hides', () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch');
    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it('refuses an opaque redirect (status 0, browser runtimes) as a redirect', async () => {
    const service = new CimdService(undefined, { network: { redirectPolicy: 'allow' } });
    mockFetch.mockResolvedValueOnce({
      type: 'opaqueredirect',
      ok: false,
      status: 0,
      headers: new Headers(),
    } as unknown as Response);

    const resolution = service.resolveClientMetadata('https://client.example.com/oauth/metadata.json');

    await expect(resolution).rejects.toBeInstanceOf(CimdFetchError);
    await expect(resolution).rejects.toThrow(/redirect/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
