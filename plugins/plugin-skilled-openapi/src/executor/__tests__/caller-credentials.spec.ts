import { AUTH_PROVIDERS_ACCESSOR, CREDENTIALS_ACCESSOR, type Credential } from '@frontmcp/auth';
import { type Token } from '@frontmcp/di';
import { ToolCredentialsRequiredError } from '@frontmcp/sdk';

import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../../skilled-openapi.symbols';
import { connectedCredentialOf } from '../connected-credential';
import { credentialResolverOf, MemoryCredentialResolver } from '../credential-resolver';

const CONNECT_URL = 'https://mcp.example.com/oauth/connect?token=signed';

interface Vaults {
  /** The credential the auth providers vault holds for the caller, or no such vault. */
  authProviders?: Credential | null;
  /** The secret the session credential vault holds for the caller (`null`: not connected), or no such vault. */
  sessionCredential?: string | null;
}

function toolCall(vaults: Vaults, providers: Map<unknown, unknown> = new Map()) {
  const authProvidersGet = jest.fn(async () =>
    vaults.authProviders ? { credential: vaults.authProviders, providerId: 'billing' } : null,
  );
  const requireConnect = jest.fn(async ({ key }: { key: string }) =>
    typeof vaults.sessionCredential === 'string'
      ? { connected: true, key, credential: { secret: vaults.sessionCredential } }
      : { connected: false, key, resumeUrl: CONNECT_URL, message: 'not connected' },
  );
  if (vaults.authProviders !== undefined) providers.set(AUTH_PROVIDERS_ACCESSOR, { get: authProvidersGet });
  if (vaults.sessionCredential !== undefined) providers.set(CREDENTIALS_ACCESSOR, { requireConnect });
  const lookup = {
    metadata: { name: 'run_workflow' },
    tryGet: <T>(token: Token<T>) => providers.get(token) as T | undefined,
    get: <T>(token: Token<T>) => {
      const provider = providers.get(token);
      if (provider === undefined) throw new Error(`no provider for ${String(token)}`);
      return provider as T;
    },
  };
  return { lookup, authProvidersGet, requireConnect };
}

describe('connectedCredentialOf', () => {
  it.each<[string, Credential, string]>([
    [
      'an OAuth credential',
      { type: 'oauth', accessToken: 'oauth-access', tokenType: 'Bearer', scopes: [] },
      'oauth-access',
    ],
    [
      'a PKCE OAuth credential',
      { type: 'oauth_pkce', accessToken: 'pkce-access', tokenType: 'Bearer', scopes: [] },
      'pkce-access',
    ],
    ['a bearer credential', { type: 'bearer', token: 'bearer-token' }, 'bearer-token'],
    ['an API key', { type: 'api_key', key: 'api-key', headerName: 'X-API-Key' }, 'api-key'],
  ])('sends %s from the auth providers vault', async (_kind, credential, secret) => {
    const { lookup, requireConnect } = toolCall({ authProviders: credential, sessionCredential: 'session-secret' });

    await expect(connectedCredentialOf('billing', lookup)).resolves.toBe(secret);
    expect(requireConnect).not.toHaveBeenCalled();
  });

  it("refuses a credential an auth binding can't send", async () => {
    const { lookup } = toolCall({ authProviders: { type: 'basic', username: 'u', password: 'p' } });

    await expect(connectedCredentialOf('billing', lookup)).rejects.toThrow(
      `the "billing" credential is a basic credential, which an auth binding can't send`,
    );
  });

  it('reads the session credential vault when the auth providers vault has none', async () => {
    const { lookup, requireConnect } = toolCall({ authProviders: null, sessionCredential: 'session-secret' });

    await expect(connectedCredentialOf('billing', lookup)).resolves.toBe('session-secret');
    expect(requireConnect).toHaveBeenCalledWith({ key: 'billing' });
  });

  it('asks a caller who has not connected the provider to connect it, at the session vault connect URL', async () => {
    const { lookup } = toolCall({ authProviders: null, sessionCredential: null });

    const call = connectedCredentialOf('billing', lookup);

    await expect(call).rejects.toBeInstanceOf(ToolCredentialsRequiredError);
    await expect(call).rejects.toMatchObject({ toolId: 'run_workflow', providers: ['billing'], authUrl: CONNECT_URL });
  });

  it('keeps the connect URL out of the message, which reaches workflow errors and the audit log', async () => {
    const call = connectedCredentialOf('billing', toolCall({ authProviders: null, sessionCredential: null }).lookup);

    await expect(call).rejects.toThrow(
      `Tool "run_workflow" sends the caller's own "billing" credential, which this caller hasn't connected. Connect "billing" and retry.`,
    );
    await expect(call).rejects.not.toThrow(CONNECT_URL);
  });

  it('asks the caller to connect it, without a URL, when the server has no vault', async () => {
    const call = connectedCredentialOf('billing', toolCall({}).lookup);

    await expect(call).rejects.toMatchObject({ providers: ['billing'], authUrl: undefined });
  });
});

describe('credentialResolverOf', () => {
  const authInfo = { sessionId: 'session-1', user: { sub: 'alice', iss: 'test' } };
  const resolveOptions = { bundleId: 'acme', authInfo };

  function configWith(authProviders: Record<string, string>): SkilledOpenApiConfig {
    return new SkilledOpenApiConfig({ authProviders } as never);
  }

  it("reads a vaultRef the authProviders option maps from the caller's vault, never from the resolver", async () => {
    const custom = { resolve: jest.fn(async () => 'from-resolver') };
    const { lookup, authProvidersGet } = toolCall(
      { authProviders: { type: 'bearer', token: 'alice-token' } },
      new Map<unknown, unknown>([
        [SkilledOpenApiConfig, configWith({ 'billing-token': 'billing' })],
        [SkilledOpenApiCredentialResolver, custom],
      ]),
    );

    await expect(credentialResolverOf(lookup).resolve('billing-token', resolveOptions)).resolves.toBe('alice-token');
    expect(authProvidersGet).toHaveBeenCalledWith('billing');
    expect(custom.resolve).not.toHaveBeenCalled();
  });

  it('never falls back to the credentials option for a mapped vaultRef the caller has not connected', async () => {
    const { lookup } = toolCall(
      { authProviders: null },
      new Map<unknown, unknown>([
        [SkilledOpenApiConfig, configWith({ 'billing-token': 'billing' })],
        [MemoryCredentialResolver, new MemoryCredentialResolver({ 'billing-token': 'shared-secret' })],
      ]),
    );

    await expect(credentialResolverOf(lookup).resolve('billing-token', resolveOptions)).rejects.toBeInstanceOf(
      ToolCredentialsRequiredError,
    );
  });

  it('asks a custom resolver for any other vaultRef, telling it the bundle and the caller', async () => {
    const custom = { resolve: jest.fn(async () => 'from-resolver') };
    const { lookup } = toolCall(
      {},
      new Map<unknown, unknown>([
        [SkilledOpenApiConfig, configWith({ 'billing-token': 'billing' })],
        [SkilledOpenApiCredentialResolver, custom],
      ]),
    );

    await expect(credentialResolverOf(lookup).resolve('reports-token', resolveOptions)).resolves.toBe('from-resolver');
    expect(custom.resolve).toHaveBeenCalledWith('reports-token', resolveOptions);
  });

  it('reads the credentials option without a custom resolver', async () => {
    const { lookup } = toolCall(
      {},
      new Map<unknown, unknown>([
        [SkilledOpenApiConfig, configWith({})],
        [MemoryCredentialResolver, new MemoryCredentialResolver({ 'reports-token': 'static-secret' })],
      ]),
    );

    await expect(credentialResolverOf(lookup).resolve('reports-token', resolveOptions)).resolves.toBe('static-secret');
  });
});
