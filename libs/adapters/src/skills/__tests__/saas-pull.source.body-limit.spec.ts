/**
 * A pull reads at most 32 MiB of the endpoint's body, the most a bundle can be canonicalized at, and stops reading
 * as soon as the body passes it.
 */
import type { SaasSourceOptions } from '../source-options';
import { SaasPullSource } from '../sources/saas-pull.source';
import { createSaasTokenIssuer, SAAS_JWKS_URL, type SaasTokenIssuer } from './saas-token.fixture';

const ENDPOINT = 'https://cloud.example.dev/v1/bundles/acme';
const MIB = 1024 * 1024;

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

let issuer: SaasTokenIssuer;
let pullToken: string;
beforeAll(async () => {
  issuer = await createSaasTokenIssuer();
  pullToken = await issuer.token();
});

const createSource = () =>
  new SaasPullSource(
    {
      type: 'saas',
      endpoint: ENDPOINT,
      authToken: pullToken,
      expectedAudience: 'acme:prod',
      pollIntervalMs: 60_000,
      enableWebhook: false,
      jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
      expectedIssuer: 'https://cloud.example.dev',
    } satisfies SaasSourceOptions,
    undefined,
    fakeLogger,
    { disablePolling: true, cache: { read: async () => undefined, write: async () => undefined } },
  );

/** A response whose body offers `chunks` chunks of 1 MiB, one at a time, and counts the ones it handed out. */
function streamedResponse(chunks: number): { response: Response; chunksRead: () => number } {
  const chunk = new Uint8Array(MIB).fill(0x20);
  let handedOut = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (handedOut === chunks) return controller.close();
      handedOut++;
      controller.enqueue(chunk);
    },
  });
  return { response: new Response(body, { status: 200 }), chunksRead: () => handedOut };
}

describe('SaasPullSource — the size of a pulled body', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stops reading a body as soon as it passes 32 MiB, and fails the pull', async () => {
    const { response, chunksRead } = streamedResponse(64);
    global.fetch = jest.fn(async (url: string | URL) =>
      String(url) === SAAS_JWKS_URL ? new Response(JSON.stringify(issuer.jwks), { status: 200 }) : response,
    ) as unknown as typeof fetch;

    await expect(createSource().refresh()).rejects.toThrow(/exceeds the limit of 33554432 bytes/);
    expect(chunksRead()).toBeLessThan(64);
  });
});
