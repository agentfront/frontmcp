/**
 * LocalPrimaryAuth — declarative `auth.providers` → registerProvider bridge.
 *
 * Verifies that upstream providers declared on `mode: 'local'` are registered
 * into the upstream-provider registry during initialize(): canonical endpoint
 * names, the authorizeUrl/tokenUrl aliases, name/scopes defaulting, and the
 * computed per-provider callback URL (`${issuer}/oauth/provider/${id}/callback`).
 * Also confirms the default (no providers) path registers nothing.
 */
import 'reflect-metadata';

import { LocalPrimaryAuth } from '../instance.local-primary-auth';

function createProviders() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  const activeScope = {
    logger,
    metadata: { http: { port: 3001 } },
    registryFlows: jest.fn().mockResolvedValue(undefined),
  };
  return {
    getActiveScope: () => activeScope,
    injectProvider: jest.fn(),
    addDynamicProviders: jest.fn().mockResolvedValue(undefined),
  } as never;
}

function createScope() {
  return { fullPath: '' } as never;
}

async function makeAuth(options: Record<string, unknown>) {
  const auth = new LocalPrimaryAuth(createScope(), createProviders(), options as never);
  await auth.ready;
  return auth;
}

describe('LocalPrimaryAuth — declarative providers bridge', () => {
  it('registers a provider declared with canonical endpoint names', async () => {
    const auth = await makeAuth({
      mode: 'local',
      providers: [
        {
          id: 'github',
          name: 'GitHub',
          authorizationEndpoint: 'https://github.example.com/authorize',
          tokenEndpoint: 'https://github.example.com/token',
          userInfoEndpoint: 'https://github.example.com/user',
          clientId: 'gh-client',
          clientSecret: 'gh-secret',
          scopes: ['read:user', 'repo'],
        },
      ],
    });

    const config = auth.getProviderConfig('github');
    expect(config).toBeDefined();
    expect(config?.id).toBe('github');
    expect(config?.name).toBe('GitHub');
    expect(config?.authorizationEndpoint).toBe('https://github.example.com/authorize');
    expect(config?.tokenEndpoint).toBe('https://github.example.com/token');
    expect(config?.userInfoEndpoint).toBe('https://github.example.com/user');
    expect(config?.clientId).toBe('gh-client');
    expect(config?.clientSecret).toBe('gh-secret');
    expect(config?.scopes).toEqual(['read:user', 'repo']);
    // callbackUrl computed from the issuer.
    expect(config?.callbackUrl).toBe(`${auth.issuer}/oauth/provider/github/callback`);
  });

  it('maps authorizeUrl/tokenUrl aliases and defaults name/scopes', async () => {
    const auth = await makeAuth({
      mode: 'local',
      providers: [
        {
          id: 'slack',
          authorizeUrl: 'https://slack.example.com/authorize',
          tokenUrl: 'https://slack.example.com/token',
          clientId: 'slack-client',
        },
      ],
    });

    const config = auth.getProviderConfig('slack');
    expect(config).toBeDefined();
    expect(config?.authorizationEndpoint).toBe('https://slack.example.com/authorize');
    expect(config?.tokenEndpoint).toBe('https://slack.example.com/token');
    // name defaults to id, scopes default to [].
    expect(config?.name).toBe('slack');
    expect(config?.scopes).toEqual([]);
    expect(config?.callbackUrl).toBe(`${auth.issuer}/oauth/provider/slack/callback`);
  });

  it('registers every provider in a multi-provider config', async () => {
    const auth = await makeAuth({
      mode: 'local',
      providers: [
        {
          id: 'github',
          authorizationEndpoint: 'https://github.example.com/authorize',
          tokenEndpoint: 'https://github.example.com/token',
          clientId: 'gh-client',
        },
        {
          id: 'slack',
          authorizeUrl: 'https://slack.example.com/authorize',
          tokenUrl: 'https://slack.example.com/token',
          clientId: 'slack-client',
        },
        {
          id: 'jira',
          authorizationEndpoint: 'https://jira.example.com/authorize',
          tokenEndpoint: 'https://jira.example.com/token',
          clientId: 'jira-client',
        },
      ],
    });

    expect(auth.getProviderConfig('github')).toBeDefined();
    expect(auth.getProviderConfig('slack')).toBeDefined();
    expect(auth.getProviderConfig('jira')).toBeDefined();
  });

  it('registers nothing when no providers are declared (default preserved)', async () => {
    const auth = await makeAuth({ mode: 'local' });
    expect(auth.getProviderConfig('github')).toBeUndefined();
  });

  it('registers nothing in public mode even if a providers array leaks in', async () => {
    const auth = await makeAuth({
      mode: 'public',
      // public mode has no `providers` field; ensure the bridge no-ops.
      providers: [
        {
          id: 'github',
          authorizationEndpoint: 'https://github.example.com/authorize',
          tokenEndpoint: 'https://github.example.com/token',
          clientId: 'gh-client',
        },
      ],
    });
    expect(auth.getProviderConfig('github')).toBeUndefined();
  });
});

describe('LocalPrimaryAuth — remote-mode single upstream provider', () => {
  it('registers the flat remote config as one upstream provider with derived endpoints', async () => {
    const auth = await makeAuth({
      mode: 'remote',
      provider: 'https://auth.example.com',
      clientId: 'remote-client',
      clientSecret: 'remote-secret',
      scopes: ['openid', 'profile', 'email'],
    });

    // Provider id is derived from the provider hostname (dots → underscores).
    const id = auth.remoteProviderId;
    expect(id).toBe('auth_example_com');

    const config = auth.getProviderConfig(id!);
    expect(config).toBeDefined();
    // Endpoints derived from the base URL using standard OIDC paths.
    expect(config?.authorizationEndpoint).toBe('https://auth.example.com/authorize');
    expect(config?.tokenEndpoint).toBe('https://auth.example.com/token');
    expect(config?.userInfoEndpoint).toBe('https://auth.example.com/userinfo');
    expect(config?.jwksUri).toBe('https://auth.example.com/.well-known/jwks.json');
    expect(config?.clientId).toBe('remote-client');
    expect(config?.clientSecret).toBe('remote-secret');
    expect(config?.scopes).toEqual(['openid', 'profile', 'email']);
    expect(config?.callbackUrl).toBe(`${auth.issuer}/oauth/provider/${id}/callback`);
  });

  it('honors providerConfig endpoint overrides and explicit id', async () => {
    const auth = await makeAuth({
      mode: 'remote',
      provider: 'https://legacy-idp.example.com',
      clientId: 'legacy-client',
      providerConfig: {
        id: 'legacy',
        name: 'Legacy IdP',
        authEndpoint: 'https://legacy-idp.example.com/auth',
        tokenEndpoint: 'https://legacy-idp.example.com/oauth/token',
        userInfoEndpoint: 'https://legacy-idp.example.com/me',
        jwksUri: 'https://legacy-idp.example.com/keys',
      },
    });

    expect(auth.remoteProviderId).toBe('legacy');
    const config = auth.getProviderConfig('legacy');
    expect(config?.name).toBe('Legacy IdP');
    expect(config?.authorizationEndpoint).toBe('https://legacy-idp.example.com/auth');
    expect(config?.tokenEndpoint).toBe('https://legacy-idp.example.com/oauth/token');
    expect(config?.userInfoEndpoint).toBe('https://legacy-idp.example.com/me');
    expect(config?.jwksUri).toBe('https://legacy-idp.example.com/keys');
  });

  it('defaults scopes to ["openid"] when none are provided', async () => {
    const auth = await makeAuth({
      mode: 'remote',
      provider: 'https://auth.example.com',
      clientId: 'remote-client',
    });
    const config = auth.getProviderConfig(auth.remoteProviderId!);
    expect(config?.scopes).toEqual(['openid']);
  });

  it('strips a trailing slash from the provider base URL when deriving endpoints', async () => {
    const auth = await makeAuth({
      mode: 'remote',
      provider: 'https://auth.example.com/',
      clientId: 'remote-client',
    });
    const config = auth.getProviderConfig(auth.remoteProviderId!);
    expect(config?.authorizationEndpoint).toBe('https://auth.example.com/authorize');
    expect(config?.tokenEndpoint).toBe('https://auth.example.com/token');
  });

  it('does not register a provider when clientId is missing (DCR not wired)', async () => {
    const auth = await makeAuth({
      mode: 'remote',
      provider: 'https://auth.example.com',
      // no clientId — registration is skipped, remoteProviderId still derived.
    });
    expect(auth.remoteProviderId).toBe('auth_example_com');
    expect(auth.getProviderConfig('auth_example_com')).toBeUndefined();
  });

  it('does not register a remote provider in local mode', async () => {
    const auth = await makeAuth({ mode: 'local' });
    expect(auth.remoteProviderId).toBeUndefined();
  });
});

describe('LocalPrimaryAuth — exchangeProviderCode upstream validation', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  async function authWithGithub() {
    return makeAuth({
      mode: 'local',
      providers: [
        {
          id: 'github',
          authorizeUrl: 'https://gh.example.com/authorize',
          tokenUrl: 'https://gh.example.com/token',
          clientId: 'gh-client',
        },
      ],
    });
  }

  // A 200 without access_token must be treated as an exchange error so the
  // federated flow halts and never mints a JWT that claims the provider is
  // linked while the orchestration token store holds an empty credential.
  it('rejects a 200 response that omits access_token', async () => {
    const auth = await authWithGithub();
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ token_type: 'Bearer' }) }) as never;

    const result = await auth.exchangeProviderCode('github', 'code-123');
    expect('error' in result).toBe(true);
    expect((result as { error: string }).error).toBe('provider_error');
  });

  it('rejects a 200 response with an empty access_token', async () => {
    const auth = await authWithGithub();
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: '' }) }) as never;

    const result = await auth.exchangeProviderCode('github', 'code-123');
    expect('error' in result).toBe(true);
  });

  it('returns the token payload when access_token is present', async () => {
    const auth = await authWithGithub();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'gho_abc', token_type: 'Bearer', expires_in: 3600 }),
    }) as never;

    const result = await auth.exchangeProviderCode('github', 'code-123');
    expect('error' in result).toBe(false);
    expect((result as { access_token: string }).access_token).toBe('gho_abc');
  });
});
