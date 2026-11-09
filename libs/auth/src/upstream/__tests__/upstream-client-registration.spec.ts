import { MemoryStorageAdapter, randomBytes, StorageNotSupportedError } from '@frontmcp/utils';

import {
  resolveUpstreamClient,
  UpstreamClientRegistrationError,
  type UpstreamClientRegistrationOptions,
} from '../upstream-client-registration';

const PROVIDER = 'https://idp.example.com';
const REDIRECT_URI = 'https://mcp.example.com/oauth/provider/idp_example_com/callback';
const REGISTRATION_ENDPOINT = 'https://idp.example.com/oidc/register';

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockProvider(routes: Record<string, () => Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    return route ? route() : new Response('not found', { status: 404 });
  });
  return calls;
}

function registrationRoute(clientId: string, extra: Record<string, unknown> = {}): () => Response {
  return () => jsonResponse(201, { client_id: clientId, client_secret: `${clientId}-secret`, ...extra });
}

const asMetadataRoute = () => jsonResponse(200, { issuer: PROVIDER, registration_endpoint: REGISTRATION_ENDPOINT });

function options(overrides: Partial<UpstreamClientRegistrationOptions> = {}): UpstreamClientRegistrationOptions {
  return {
    provider: PROVIDER,
    redirectUri: REDIRECT_URI,
    clientName: 'Notes MCP',
    scopes: ['openid', 'email'],
    encryptionKey: new TextEncoder().encode('k'.repeat(32)),
    ...overrides,
  };
}

function registrationCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.init?.method === 'POST');
}

describe('resolveUpstreamClient', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    jest.restoreAllMocks();
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('registers at the registration_endpoint of the provider metadata', async () => {
    const calls = mockProvider({
      [`${PROVIDER}/.well-known/oauth-authorization-server`]: asMetadataRoute,
      [REGISTRATION_ENDPOINT]: registrationRoute('dcr-client'),
    });

    const client = await resolveUpstreamClient(options());

    expect(client).toEqual({
      clientId: 'dcr-client',
      clientSecret: 'dcr-client-secret',
      clientSecretExpiresAt: undefined,
      redirectUri: REDIRECT_URI,
    });
    const [registration] = registrationCalls(calls);
    expect(registration.url).toBe(REGISTRATION_ENDPOINT);
    expect(JSON.parse(String(registration.init?.body))).toEqual({
      client_name: 'Notes MCP',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'openid email',
    });
  });

  it('uses a configured registrationEndpoint without reading the metadata', async () => {
    const calls = mockProvider({ 'https://idp.example.com/custom/register': registrationRoute('configured') });

    const client = await resolveUpstreamClient(
      options({ registrationEndpoint: 'https://idp.example.com/custom/register' }),
    );

    expect(client.clientId).toBe('configured');
    expect(calls.map((call) => call.url)).toEqual(['https://idp.example.com/custom/register']);
  });

  it('falls back to the OpenID metadata, with the path of an issuer that has one', async () => {
    const issuer = 'https://idp.example.com/realms/notes';
    const calls = mockProvider({
      [`${issuer}/.well-known/openid-configuration`]: () =>
        jsonResponse(200, { issuer, registration_endpoint: `${issuer}/clients-registrations/openid-connect` }),
      [`${issuer}/clients-registrations/openid-connect`]: registrationRoute('keycloak-client'),
    });

    const client = await resolveUpstreamClient(options({ provider: issuer }));

    expect(client.clientId).toBe('keycloak-client');
    expect(calls[0].url).toBe('https://idp.example.com/.well-known/oauth-authorization-server/realms/notes');
  });

  it('ignores metadata whose issuer is not the provider', async () => {
    mockProvider({
      [`${PROVIDER}/.well-known/oauth-authorization-server`]: () =>
        jsonResponse(200, { issuer: 'https://other.example.com', registration_endpoint: REGISTRATION_ENDPOINT }),
      [REGISTRATION_ENDPOINT]: registrationRoute('never'),
    });

    await expect(resolveUpstreamClient(options())).rejects.toThrow(
      'no registration_endpoint found in https://idp.example.com/.well-known/oauth-authorization-server or https://idp.example.com/.well-known/openid-configuration',
    );
  });

  it('names the error the provider answers with', async () => {
    mockProvider({
      [REGISTRATION_ENDPOINT]: () =>
        jsonResponse(400, { error: 'invalid_redirect_uri', error_description: 'http redirect URIs are refused' }),
    });

    const result = resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT }));

    await expect(result).rejects.toBeInstanceOf(UpstreamClientRegistrationError);
    await expect(result).rejects.toThrow(
      `${REGISTRATION_ENDPOINT} answered 400: invalid_redirect_uri (http redirect URIs are refused)`,
    );
  });

  it('refuses a registration without a client_id', async () => {
    mockProvider({ [REGISTRATION_ENDPOINT]: () => jsonResponse(201, { client_secret: 'orphan' }) });

    await expect(resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT }))).rejects.toThrow(
      'answered without a client_id',
    );
  });

  it('refuses a registration for other redirect URIs', async () => {
    mockProvider({
      [REGISTRATION_ENDPOINT]: registrationRoute('moved', { redirect_uris: ['https://elsewhere.example.com/cb'] }),
    });

    await expect(resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT }))).rejects.toThrow(
      `the provider registered other redirect URIs than ${REDIRECT_URI}`,
    );
  });

  it('refuses a plain-http provider in production', async () => {
    process.env['NODE_ENV'] = 'production';
    const calls = mockProvider({});

    await expect(
      resolveUpstreamClient(options({ registrationEndpoint: 'http://idp.example.com/register' })),
    ).rejects.toThrow('http://idp.example.com/register is not an https URL');
    expect(calls).toHaveLength(0);
  });

  it('names an endpoint it could not reach', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT }))).rejects.toThrow(
      `${REGISTRATION_ENDPOINT} could not be reached (fetch failed)`,
    );
  });

  it('warns when the provider registers another token endpoint auth method', async () => {
    mockProvider({
      [REGISTRATION_ENDPOINT]: registrationRoute('basic', { token_endpoint_auth_method: 'client_secret_basic' }),
    });
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    await resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT, logger }));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('token_endpoint_auth_method "client_secret_basic"'),
    );
  });

  describe('with persistent storage', () => {
    let storage: MemoryStorageAdapter;

    beforeEach(async () => {
      storage = new MemoryStorageAdapter();
      await storage.connect();
    });

    afterEach(async () => {
      await storage.disconnect();
    });

    it('reuses the stored client and keeps its secret encrypted', async () => {
      const calls = mockProvider({ [REGISTRATION_ENDPOINT]: registrationRoute('stored') });
      const withStorage = options({ registrationEndpoint: REGISTRATION_ENDPOINT, storage });

      const first = await resolveUpstreamClient(withStorage);
      const second = await resolveUpstreamClient(withStorage);

      expect(second).toEqual(first);
      expect(registrationCalls(calls)).toHaveLength(1);
      const [key] = await storage.keys('upstream-client:*');
      expect(await storage.get(key)).not.toContain('stored-secret');
    });

    it('registers again for another redirect URI', async () => {
      let count = 0;
      const calls = mockProvider({ [REGISTRATION_ENDPOINT]: () => registrationRoute(`client-${++count}`)() });

      await resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT, storage }));
      const moved = await resolveUpstreamClient(
        options({ registrationEndpoint: REGISTRATION_ENDPOINT, storage, redirectUri: 'https://new.example.com/cb' }),
      );

      expect(moved.clientId).toBe('client-2');
      expect(registrationCalls(calls)).toHaveLength(2);
    });

    it('replaces a stored client it cannot decrypt', async () => {
      let count = 0;
      mockProvider({ [REGISTRATION_ENDPOINT]: () => registrationRoute(`client-${++count}`)() });
      await resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT, storage }));

      const rotatedKey = options({
        registrationEndpoint: REGISTRATION_ENDPOINT,
        storage,
        encryptionKey: randomBytes(32),
      });
      const replaced = await resolveUpstreamClient(rotatedKey);
      const reused = await resolveUpstreamClient(rotatedKey);

      expect(replaced.clientId).toBe('client-2');
      expect(reused.clientId).toBe('client-2');
    });

    it('registers again once the client secret expired', async () => {
      const expiredAt = Math.floor(Date.now() / 1000) - 10;
      let count = 0;
      mockProvider({
        [REGISTRATION_ENDPOINT]: () =>
          registrationRoute(`client-${++count}`, { client_secret_expires_at: count === 1 ? expiredAt : 0 })(),
      });
      const withStorage = options({ registrationEndpoint: REGISTRATION_ENDPOINT, storage });

      await resolveUpstreamClient(withStorage);
      const renewed = await resolveUpstreamClient(withStorage);

      expect(renewed.clientId).toBe('client-2');
    });

    it('uses the client another instance stored first', async () => {
      let count = 0;
      mockProvider({ [REGISTRATION_ENDPOINT]: () => registrationRoute(`client-${++count}`)() });
      const withStorage = options({ registrationEndpoint: REGISTRATION_ENDPOINT, storage });
      const winner = await resolveUpstreamClient(withStorage);
      jest.spyOn(storage, 'get').mockResolvedValueOnce(null);

      const loser = await resolveUpstreamClient(withStorage);

      expect(loser).toEqual(winner);
    });

    it('registers when the storage cannot be read, and keeps the client when it cannot be written', async () => {
      mockProvider({ [REGISTRATION_ENDPOINT]: registrationRoute('unstored') });
      jest.spyOn(storage, 'get').mockRejectedValue(new Error('connection lost'));
      jest.spyOn(storage, 'set').mockRejectedValue(new Error('connection lost'));

      const client = await resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT, storage }));

      expect(client.clientId).toBe('unstored');
    });

    it('stores without a conditional write on a backend that has none', async () => {
      mockProvider({ [REGISTRATION_ENDPOINT]: registrationRoute('kv-client') });
      const originalSet = storage.set.bind(storage);
      jest.spyOn(storage, 'set').mockImplementation(async (key, value, setOptions) => {
        if (setOptions?.ifNotExists) throw new StorageNotSupportedError('set ifNotExists', 'kv');
        return originalSet(key, value, setOptions);
      });

      const client = await resolveUpstreamClient(options({ registrationEndpoint: REGISTRATION_ENDPOINT, storage }));

      expect(client.clientId).toBe('kv-client');
      expect(await storage.keys('upstream-client:*')).toHaveLength(1);
    });
  });
});
