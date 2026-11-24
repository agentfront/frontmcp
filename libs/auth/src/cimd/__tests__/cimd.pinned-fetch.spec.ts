/**
 * CIMD and JWKS fetches connect only to the addresses the private-address check approved, on the
 * first request and on every redirect hop, so a second DNS answer is never used.
 */
import * as dns from 'node:dns';

import { pinnedFetch } from '@frontmcp/utils';

import { JwksService } from '../../jwks/jwks.service';
import { CimdService } from '../cimd.service';
import { fetchPinnedTo } from '../cimd.validator';

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));
jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  pinnedFetch: jest.fn(),
}));

const mockDnsLookup = dns.promises.lookup as unknown as jest.Mock;
const mockPinnedFetch = pinnedFetch as jest.Mock;

const ANSWERS: Record<string, dns.LookupAddress[]> = {
  'client.example.com': [{ address: '93.184.216.34', family: 4 }],
  'cdn.example.com': [
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    { address: '93.184.216.35', family: 4 },
  ],
};

const METADATA = {
  client_id: 'https://client.example.com/oauth/metadata.json',
  client_name: 'Pinned Client',
  redirect_uris: ['https://client.example.com/callback'],
  token_endpoint_auth_method: 'none',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('CIMD and JWKS fetches pinned to the checked addresses', () => {
  let pinnedRequests: Array<{ addresses: dns.LookupAddress[]; url: string }>;
  let answer: (url: string) => Response;
  let plainFetch: jest.SpyInstance;

  beforeEach(() => {
    pinnedRequests = [];
    mockDnsLookup.mockReset();
    mockDnsLookup.mockImplementation(async (hostname: string) => ANSWERS[hostname] ?? []);
    mockPinnedFetch.mockReset();
    mockPinnedFetch.mockImplementation((addresses: dns.LookupAddress[]) => async (input: string | URL) => {
      pinnedRequests.push({ addresses, url: String(input) });
      return answer(String(input));
    });
    plainFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    plainFetch.mockRestore();
  });

  it('fetches a client metadata document from the address the check approved', async () => {
    answer = () => jsonResponse(METADATA);

    await new CimdService().resolveClientMetadata(METADATA.client_id);

    expect(pinnedRequests).toEqual([{ addresses: ANSWERS['client.example.com'], url: METADATA.client_id }]);
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('pins each redirect hop to the addresses checked for its own host', async () => {
    const movedUrl = 'https://cdn.example.com/metadata.json';
    answer = (url) =>
      url === METADATA.client_id
        ? new Response(null, { status: 302, headers: { location: movedUrl } })
        : jsonResponse(METADATA);

    await new CimdService(undefined, { network: { redirectPolicy: 'allow' } }).resolveClientMetadata(
      METADATA.client_id,
    );

    expect(pinnedRequests).toEqual([
      { addresses: ANSWERS['client.example.com'], url: METADATA.client_id },
      { addresses: ANSWERS['cdn.example.com'], url: movedUrl },
    ]);
  });

  it('fetches with plain fetch when blockPrivateIPs is off, as nothing was checked', async () => {
    plainFetch.mockResolvedValue(jsonResponse(METADATA));

    await new CimdService(undefined, { security: { blockPrivateIPs: false } }).resolveClientMetadata(
      METADATA.client_id,
    );

    expect(mockPinnedFetch).not.toHaveBeenCalled();
    expect(plainFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches a provider key set from the address the check approved', async () => {
    answer = () => jsonResponse({ keys: [] });

    await (new JwksService() as unknown as { fetchJson(url: string): Promise<unknown> }).fetchJson(
      'https://cdn.example.com/jwks.json',
    );

    expect(pinnedRequests).toEqual([
      { addresses: ANSWERS['cdn.example.com'], url: 'https://cdn.example.com/jwks.json' },
    ]);
    expect(plainFetch).not.toHaveBeenCalled();
  });
});

describe('CIMD and JWKS answers whose body is not read', () => {
  let cancelled: string[];
  let answer: (url: string) => Response;

  /** A response whose body never ends, as a pinned connection's does until it is cancelled. */
  function openResponse(label: string, status: number, headers: Record<string, string> = {}): Response {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new TextEncoder().encode('{')),
      cancel: () => {
        cancelled.push(label);
      },
    });
    return new Response(body, { status, headers });
  }

  beforeEach(() => {
    cancelled = [];
    mockDnsLookup.mockReset();
    mockDnsLookup.mockImplementation(async (hostname: string) => ANSWERS[hostname] ?? []);
    mockPinnedFetch.mockReset();
    mockPinnedFetch.mockImplementation(() => async (input: string | URL) => answer(String(input)));
  });

  const fetchJwks = (url: string) =>
    (new JwksService() as unknown as { fetchJson(url: string): Promise<unknown> }).fetchJson(url);

  it('cancels a redirect body before following it', async () => {
    const movedUrl = 'https://cdn.example.com/metadata.json';
    answer = (url) =>
      url === METADATA.client_id ? openResponse('redirect', 302, { location: movedUrl }) : jsonResponse(METADATA);

    await new CimdService(undefined, { network: { redirectPolicy: 'allow' } }).resolveClientMetadata(
      METADATA.client_id,
    );

    expect(cancelled).toEqual(['redirect']);
  });

  it.each([
    ['an error status', () => openResponse('error', 500)],
    ['a Content-Length over the limit', () => openResponse('oversized', 200, { 'content-length': '10000000' })],
  ])('cancels the body of %s', async (_label, respond) => {
    answer = respond;

    await expect(new CimdService().resolveClientMetadata(METADATA.client_id)).rejects.toThrow();

    expect(cancelled).toHaveLength(1);
  });

  it('cancels a JWKS redirect body before following it, and an error body', async () => {
    answer = (url) =>
      url.endsWith('/old.json')
        ? openResponse('redirect', 301, { location: 'https://cdn.example.com/jwks.json' })
        : openResponse('error', 404);

    await expect(fetchJwks('https://cdn.example.com/old.json')).rejects.toThrow('HTTP 404');

    expect(cancelled).toEqual(['redirect', 'error']);
  });
});

describe('fetchPinnedTo', () => {
  it('is plain fetch when there are no checked addresses to pin to', () => {
    expect(fetchPinnedTo(undefined)).toBe(fetch);
    expect(fetchPinnedTo([])).toBe(fetch);
  });
});
