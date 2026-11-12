import * as dns from 'node:dns';

import { ResponseTooLargeError } from '@frontmcp/utils';

import { JwksService } from '../jwks.service';

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const mockDnsLookup = dns.promises.lookup as unknown as jest.Mock;

type FetchJson = { fetchJson(url: string): Promise<unknown> };

const MAX_BYTES = 1_048_576;

/** A response whose body arrives in 64 KiB chunks with no Content-Length, counting how many chunks were pulled. */
function streamedResponse(totalBytes: number): { response: Response; pulled: () => number } {
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  let sent = 0;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return { response: new Response(body, { status: 200 }), pulled: () => pulls };
}

describe('JwksService — size limit on JWKS and discovery responses', () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch');
    mockDnsLookup.mockReset();
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it('stops reading a body without Content-Length once it passes 1 MiB', async () => {
    const { response, pulled } = streamedResponse(64 * MAX_BYTES);
    mockFetch.mockResolvedValue(response);
    const service = new JwksService() as unknown as FetchJson;

    await expect(service.fetchJson('https://idp.example.com/.well-known/jwks.json')).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    expect(pulled()).toBeLessThanOrEqual(MAX_BYTES / (64 * 1024) + 2);
  });

  it('still reads a key set under the limit', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ keys: [] }), { status: 200 }));
    const service = new JwksService() as unknown as FetchJson;

    await expect(service.fetchJson('https://idp.example.com/.well-known/jwks.json')).resolves.toEqual({ keys: [] });
  });
});
