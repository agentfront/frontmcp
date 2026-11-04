// A real server whose saas source has enableWebhook takes pushed bundles at POST /__skilled_openapi/push.
import 'reflect-metadata';

import { BundleStore } from '@frontmcp/adapters/skills';
import { createWebFetchHandler, FrontMcpInstance, LogLevel, type WebFetchHandler } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';
import { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN } from '../skilled-openapi.plugin';
import { AUDIENCE, bundle, ENDPOINT, ISSUER, JWKS_URL, signed, tokenIssuer, trustedKey } from './saas-bundles.fixture';

const PUSH_URL = 'http://localhost/__skilled_openapi/push';

interface PushServer {
  handler: WebFetchHandler;
  servedVersion: () => string | undefined;
}

describe('pushed bundles on a server with enableWebhook', () => {
  let issuer: Awaited<ReturnType<typeof tokenIssuer>>;
  let jwksAvailable = true;
  const cache = { read: jest.fn(async () => undefined), write: jest.fn(async () => undefined) };

  async function startServer(enableWebhook: boolean): Promise<PushServer> {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'billing', version: '1.0.0' },
      apps: [],
      serve: false,
      plugins: [
        SkilledOpenApiPlugin.init({
          source: {
            type: 'saas',
            endpoint: ENDPOINT,
            authToken: await issuer.sign({}),
            expectedAudience: AUDIENCE,
            jwksUrl: JWKS_URL,
            expectedIssuer: ISSUER,
            enableWebhook,
          },
          trustedKeys: [trustedKey],
        }),
      ],
      providers: [
        {
          name: 'test:runtime-deps',
          provide: SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN,
          useValue: { cache, disablePolling: true },
        },
      ],
      logging: { level: LogLevel.Off },
    } as never);
    const scope = instance.getPrimaryScope();
    if (!scope) throw new Error('the server config produced no scope');
    await instance.emitProvidersReady();
    return {
      handler: createWebFetchHandler(scope as Parameters<typeof createWebFetchHandler>[0]),
      servedVersion: () => scope.providers.get(BundleStore).current()?.version,
    };
  }

  const push = (server: PushServer, authorization: string | undefined, body: unknown) =>
    server.handler(
      new Request(PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );

  let server: PushServer;
  let fetchMock: jest.SpyInstance;

  beforeAll(async () => {
    issuer = await tokenIssuer('cloud-2026');
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === JWKS_URL) return jwksAvailable ? Response.json(issuer.jwks) : new Response('down', { status: 503 });
      if (url === ENDPOINT) return Response.json(signed(bundle('1.0.0', ['invoices'])));
      return new Response('not found', { status: 404 });
    });
    server = await startServer(true);
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  beforeEach(() => {
    jwksAvailable = true;
    cache.write.mockClear();
  });

  it('applies a pushed bundle signed by a trusted key after the pulled one, and keeps it in the cache', async () => {
    const pushed = signed(bundle('2.0.0', ['invoices', 'refunds']));

    const response = await push(server, `Bearer ${await issuer.pushToken()}`, pushed);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: true, bundleId: 'acme:billing', bundleVersion: '2.0.0' });
    expect(server.servedVersion()).toBe('2.0.0');
    expect(cache.write).toHaveBeenCalledWith(expect.objectContaining({ version: '2.0.0' }));
  });

  it('refuses a token a push already used, with 409', async () => {
    const token = await issuer.pushToken();
    await push(server, `Bearer ${token}`, signed(bundle('3.0.0', ['invoices'])));

    const replayed = await push(server, `Bearer ${token}`, signed(bundle('4.0.0', ['invoices'])));

    expect(replayed.status).toBe(409);
    expect(await replayed.json()).toEqual({
      error: 'push_replayed',
      error_description: 'a push already used this token',
    });
    expect(server.servedVersion()).toBe('3.0.0');
  });

  it.each([
    ['no token', async () => undefined],
    ['a token another key signed', async () => `Bearer ${await (await tokenIssuer('cloud-2026')).pushToken()}`],
    ['a token without jti', async () => `Bearer ${await issuer.sign({})}`],
  ])('refuses a push with %s, with 401 and a Bearer challenge', async (_label, authorization) => {
    const response = await push(server, await authorization(), signed(bundle('5.0.0', ['refunds'])));

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    expect(await response.json()).toMatchObject({ error: 'invalid_token' });
    expect(server.servedVersion()).toBe('3.0.0');
  });

  it("answers 503 when the issuer's JWKS cannot be read once its cached keys are a minute old", async () => {
    const token = await issuer.pushToken();
    jwksAvailable = false;
    const minuteLater = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);

    try {
      const response = await push(server, `Bearer ${token}`, signed(bundle('5.0.0', ['refunds'])));

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'temporarily_unavailable' });
    } finally {
      minuteLater.mockRestore();
    }
  });

  it('refuses a body that is not a bundle, with 400', async () => {
    const notJson = await push(server, `Bearer ${await issuer.pushToken()}`, 'version: 6.0.0');
    const notBundle = await push(server, `Bearer ${await issuer.pushToken()}`, {
      schemaVersion: 1,
      bundleId: 'acme:billing',
    });

    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({
      error: 'invalid_bundle',
      error_description: 'the body must be the bundle, as JSON',
    });
    expect(notBundle.status).toBe(400);
    expect(await notBundle.json()).toMatchObject({
      error: 'invalid_bundle',
      error_description: expect.stringMatching(/^Bundle schema validation failed \(\d+ issue\(s\)\): version: /),
    });
  });

  it('refuses a bundle without a trusted signature, with 422, and keeps serving the bundle before it', async () => {
    const response = await push(server, `Bearer ${await issuer.pushToken()}`, bundle('7.0.0', ['refunds']));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'bundle_not_applied',
      error_description: expect.stringMatching(/^bundle acme:billing@7\.0\.0 was not applied: /),
    });
    expect(server.servedVersion()).toBe('3.0.0');
    expect(cache.write).not.toHaveBeenCalled();
  });

  it('serves no push endpoint when enableWebhook is off', async () => {
    const pullOnly = await startServer(false);

    const response = await push(pullOnly, `Bearer ${await issuer.pushToken()}`, signed(bundle('8.0.0', ['invoices'])));

    expect(response.status).toBe(404);
  });
});
