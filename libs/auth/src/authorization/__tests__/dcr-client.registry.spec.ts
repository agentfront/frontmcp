/**
 * DcrClientRegistry Tests (#462)
 *
 * Covers the local-AS Dynamic Client Registration registry: pre-registered
 * client seeding, dynamic registration, redirect_uri / client_id allowlists
 * (exact + simple glob), and the constant-time initial-access-token check.
 */

import { DcrClientRegistry, type RegisteredClient } from '../dcr-client.registry';

function makeClient(overrides: Partial<RegisteredClient> = {}): RegisteredClient {
  return {
    client_id: 'dyn-1',
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: ['https://app.example.com/cb'],
    created_at: Math.floor(Date.now() / 1000),
    dev: true,
    ...overrides,
  };
}

describe('DcrClientRegistry', () => {
  describe('pre-registered clients', () => {
    it('seeds declared clients with sensible defaults', () => {
      const registry = new DcrClientRegistry({
        clients: [{ clientId: 'dashboard', redirectUris: ['https://dash.example.com/cb'] }],
      });

      const client = registry.get('dashboard');
      expect(client).toBeDefined();
      expect(client?.client_id).toBe('dashboard');
      expect(client?.token_endpoint_auth_method).toBe('none');
      expect(client?.grant_types).toEqual(['authorization_code']);
      expect(client?.response_types).toEqual(['code']);
      expect(client?.preRegistered).toBe(true);
      expect(client?.dev).toBe(false);
      expect(registry.has('dashboard')).toBe(true);
    });

    it('honors explicit auth method / secret / grants on a pre-registered client', () => {
      const registry = new DcrClientRegistry({
        clients: [
          {
            clientId: 'confidential',
            clientSecret: 's3cr3t',
            redirectUris: ['https://c.example.com/cb'],
            tokenEndpointAuthMethod: 'client_secret_post',
            grantTypes: ['authorization_code', 'refresh_token'],
            clientName: 'Confidential App',
            scope: 'openid profile',
          },
        ],
      });

      const client = registry.get('confidential');
      expect(client?.client_secret).toBe('s3cr3t');
      expect(client?.token_endpoint_auth_method).toBe('client_secret_post');
      expect(client?.grant_types).toEqual(['authorization_code', 'refresh_token']);
      expect(client?.client_name).toBe('Confidential App');
      expect(client?.scope).toBe('openid profile');
    });

    it('is empty when no clients are declared', () => {
      const registry = new DcrClientRegistry({});
      expect(registry.has('anything')).toBe(false);
      expect(registry.get('anything')).toBeUndefined();
    });
  });

  describe('dynamic registration', () => {
    it('stores a dynamically-registered client', () => {
      const registry = new DcrClientRegistry({});
      const client = makeClient({ client_id: 'dyn-xyz' });
      registry.register(client);
      expect(registry.has('dyn-xyz')).toBe(true);
      expect(registry.get('dyn-xyz')).toBe(client);
    });
  });

  describe('redirect_uri allowlist', () => {
    it('allows everything when no allowlist is configured', () => {
      const registry = new DcrClientRegistry({});
      expect(registry.hasRedirectAllowlist()).toBe(false);
      expect(registry.isRedirectUriAllowed('https://anything.example.com/cb')).toBe(true);
    });

    it('enforces an exact-match allowlist', () => {
      const registry = new DcrClientRegistry({
        allowedRedirectUris: ['https://app.example.com/callback'],
      });
      expect(registry.hasRedirectAllowlist()).toBe(true);
      expect(registry.isRedirectUriAllowed('https://app.example.com/callback')).toBe(true);
      expect(registry.isRedirectUriAllowed('https://app.example.com/other')).toBe(false);
      expect(registry.isRedirectUriAllowed('https://evil.example.com/callback')).toBe(false);
    });

    it('supports simple-glob (*) matching', () => {
      const registry = new DcrClientRegistry({
        allowedRedirectUris: ['https://*.example.com/cb', 'http://localhost:*/callback'],
      });
      expect(registry.isRedirectUriAllowed('https://a.example.com/cb')).toBe(true);
      expect(registry.isRedirectUriAllowed('https://b.example.com/cb')).toBe(true);
      expect(registry.isRedirectUriAllowed('http://localhost:8080/callback')).toBe(true);
      expect(registry.isRedirectUriAllowed('http://localhost:3000/callback')).toBe(true);
      // Glob is anchored: trailing path beyond the pattern is rejected.
      expect(registry.isRedirectUriAllowed('https://a.example.com/cb/extra')).toBe(false);
      expect(registry.isRedirectUriAllowed('https://example.evil.com/cb')).toBe(false);
    });

    it('treats regex metacharacters literally (no injection)', () => {
      const registry = new DcrClientRegistry({
        allowedRedirectUris: ['https://app.example.com/cb'],
      });
      // The dot must be literal: "appXexample" must NOT match.
      expect(registry.isRedirectUriAllowed('https://appXexample.com/cb')).toBe(false);
    });

    it('handles multiple and trailing wildcards (linear glob matcher)', () => {
      const registry = new DcrClientRegistry({
        allowedRedirectUris: ['https://*.example.com/*', 'https://app.example.com/*', '*'],
      });
      // Two wildcards: subdomain + any trailing path (incl. deep paths).
      expect(registry.isRedirectUriAllowed('https://a.example.com/cb')).toBe(true);
      expect(registry.isRedirectUriAllowed('https://a.b.example.com/deep/path?x=1')).toBe(true);
      // Trailing wildcard requires the literal prefix to match exactly.
      expect(registry.isRedirectUriAllowed('https://app.example.com/anything')).toBe(true);
      // A lone `*` matches anything.
      expect(registry.isRedirectUriAllowed('custom://whatever')).toBe(true);
    });
  });

  describe('client_id allowlist', () => {
    it('allows everything when no allowlist is configured', () => {
      const registry = new DcrClientRegistry({});
      expect(registry.hasClientIdAllowlist()).toBe(false);
      expect(registry.isClientIdAllowed('any-client')).toBe(true);
    });

    it('enforces the configured allowlist', () => {
      const registry = new DcrClientRegistry({ allowedClientIds: ['a', 'b'] });
      expect(registry.hasClientIdAllowlist()).toBe(true);
      expect(registry.isClientIdAllowed('a')).toBe(true);
      expect(registry.isClientIdAllowed('b')).toBe(true);
      expect(registry.isClientIdAllowed('c')).toBe(false);
    });
  });

  describe('initial access token', () => {
    it('does not require a token when none is configured', () => {
      const registry = new DcrClientRegistry({});
      expect(registry.requiresInitialAccessToken()).toBe(false);
      // No configured token → verification always fails (callers gate on requires*).
      expect(registry.verifyInitialAccessToken('whatever')).toBe(false);
    });

    it('requires and verifies a configured token (constant-time)', () => {
      const registry = new DcrClientRegistry({ initialAccessToken: 'iat-secret-token' });
      expect(registry.requiresInitialAccessToken()).toBe(true);
      expect(registry.verifyInitialAccessToken('iat-secret-token')).toBe(true);
      expect(registry.verifyInitialAccessToken('wrong')).toBe(false);
      expect(registry.verifyInitialAccessToken(undefined)).toBe(false);
      expect(registry.verifyInitialAccessToken('')).toBe(false);
    });
  });
});
