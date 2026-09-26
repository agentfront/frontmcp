/**
 * The SaaS bundle pull never follows a redirect with its bearer token.
 *
 * The pull sends `Authorization: Bearer <authToken>` and used the WHATWG default
 * `redirect: 'follow'`, so a 3xx from the configured endpoint re-sent the credentialed request
 * to a destination the endpoint chose. The pull now asks fetch for `redirect: 'manual'` and
 * refuses any redirect, including the status-0 `opaqueredirect` browsers return.
 */
import type { SaasSourceOptions } from '../source-options';
import { SaasPullSource } from '../sources/saas-pull.source';

const ENDPOINT = 'https://cloud.example.dev/v1/bundles/acme';
const REDIRECT_TARGET = 'https://collector.attacker.example/bundles';

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as never;

const options: SaasSourceOptions = {
  type: 'saas',
  endpoint: ENDPOINT,
  authToken: 'tok',
  expectedAudience: 'acme:prod',
  pollIntervalMs: 60_000,
  enableWebhook: false,
  jwksUrl: 'https://cloud.example.dev/.well-known/jwks.json',
  expectedIssuer: 'https://cloud.example.dev',
};

const createSource = () =>
  new SaasPullSource(options, undefined, fakeLogger, {
    disablePolling: true,
    cache: { read: async () => undefined, write: async () => undefined },
  });

/** Behaves like a real fetch: follows a 3xx unless the caller asked for `redirect: 'manual'`. */
function createRedirectingFetch() {
  const fetchMock = jest.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    if (String(url) !== ENDPOINT) {
      return new Response('{}', { status: 200 });
    }
    const redirect = new Response(null, { status: 302, headers: { location: REDIRECT_TARGET } });
    return init?.redirect === 'manual' ? redirect : fetchMock(REDIRECT_TARGET, init);
  });
  return fetchMock;
}

describe('SaasPullSource — redirects are not followed with the bearer token', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('asks fetch not to follow redirects', async () => {
    const fetchMock = createRedirectingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(createSource().refresh()).rejects.toThrow();

    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('refuses a 3xx and never sends the credential to the redirect target', async () => {
    const fetchMock = createRedirectingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(createSource().refresh()).rejects.toThrow(/redirect/);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([ENDPOINT]);
  });

  it('refuses an opaque redirect (status 0, browser runtimes)', async () => {
    const opaqueRedirect = {
      type: 'opaqueredirect',
      status: 0,
      ok: false,
      headers: new Headers(),
      text: async () => '',
    };
    global.fetch = jest.fn(async () => opaqueRedirect) as unknown as typeof fetch;

    await expect(createSource().refresh()).rejects.toThrow(/redirect/);
  });
});
