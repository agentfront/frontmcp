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
