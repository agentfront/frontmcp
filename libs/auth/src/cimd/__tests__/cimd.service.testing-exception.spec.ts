import * as dns from 'node:dns';

import { CimdSecurityError } from '../cimd.errors';
import { CimdService } from '../cimd.service';

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const mockDnsLookup = dns.promises.lookup as unknown as jest.Mock;

describe('CimdService with allowInsecureForTesting', () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch');
    mockDnsLookup.mockReset();
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it('refuses a host that is not localhost and resolves to a private address, without fetching it', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const service = new CimdService(undefined, { security: { allowInsecureForTesting: true } });

    await expect(
      service.resolveClientMetadata('https://internal.example.com/oauth/metadata.json'),
    ).rejects.toBeInstanceOf(CimdSecurityError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a literal private address that is not localhost, without fetching it', async () => {
    const service = new CimdService(undefined, { security: { allowInsecureForTesting: true } });

    await expect(service.resolveClientMetadata('https://10.0.0.5/oauth/metadata.json')).rejects.toBeInstanceOf(
      CimdSecurityError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
