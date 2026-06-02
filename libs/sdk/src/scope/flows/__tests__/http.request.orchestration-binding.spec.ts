/**
 * HTTP Request Flow — `this.orchestration` request-scoped binding.
 *
 * Verifies that the `checkAuthorization` stage reconstructs an
 * OrchestratedAuthorization from the verified JWT + the primary auth's encrypted
 * token store and binds it under ORCHESTRATED_AUTH_ACCESSOR, so a tool's
 * `this.orchestration.getToken(id)` resolves a REAL upstream token (not the Null
 * fallback). Non-orchestrated scopes and tokenless requests leave it unbound.
 */
import 'reflect-metadata';

import {
  deriveAuthorizationId,
  InMemoryOrchestratedTokenStore,
  ORCHESTRATED_AUTH_ACCESSOR,
  OrchestratedAuthAccessorAdapter,
  type OrchestratedAuthAccessor,
} from '@frontmcp/auth';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpInputSchema, httpOutputSchema, type FlowMetadata } from '../../../common';
import HttpRequestFlow from '../http.request.flow';

const TOKEN = 'header.payload.orchestration-test-signature';

function createHttpRequestMetadata(): FlowMetadata<'http:request'> {
  return {
    name: 'http:request',
    plan: { pre: ['checkAuthorization'] },
    inputSchema: httpInputSchema,
    outputSchema: httpOutputSchema,
    access: 'public',
    middleware: { method: 'POST', path: '/' },
  } as unknown as FlowMetadata<'http:request'>;
}

/**
 * Run `checkAuthorization` with session:verify stubbed to return a lightweight
 * `{ token, user }` authorization (exactly what SessionVerifyFlow produces), a
 * primary auth carrying the given token store + options, and a fake context
 * that records bound context tokens.
 */
async function runCheckAuthorization(opts: {
  authOptions: unknown;
  tokenStore?: InMemoryOrchestratedTokenStore;
  token?: string;
}): Promise<Map<unknown, unknown>> {
  const contextTokens = new Map<unknown, unknown>();
  const fakeContext = {
    updateAuthInfo: jest.fn(),
    setContextToken: (token: unknown, instance: unknown) => contextTokens.set(token, instance),
    getContextTokens: () => new Map(contextTokens),
    requestId: 'req-test',
  };
  const fakeStorage = { getStore: () => fakeContext, getStoreOrThrow: () => fakeContext };

  const scope = createMockScopeEntry({ auth: { mode: 'local' } as never });
  // Attach the token store + the real (orchestrated) options to the primary auth.
  (scope as unknown as { auth: Record<string, unknown> }).auth.orchestratedTokenStore = opts.tokenStore;
  (scope as unknown as { auth: Record<string, unknown> }).auth.options = opts.authOptions;

  const token = opts.token ?? TOKEN;
  (scope.runFlow as jest.Mock).mockResolvedValue({
    kind: 'authorized',
    authorization: { token, user: { sub: 'user-1', name: 'Alice' } },
  });
  // tryGetContext() resolves the context storage from scope.providers (returning
  // the fake storage for any token avoids cross-module token-identity issues).
  (scope.providers.get as jest.Mock).mockReturnValue(fakeStorage);

  const input = createMockHttpRequest({ method: 'POST', path: '/' });
  const flow = new HttpRequestFlow(createHttpRequestMetadata(), input as never, scope, jest.fn(), new Map());
  await runFlowStages(flow, ['checkAuthorization']);

  return contextTokens;
}

describe('HTTP Request Flow — this.orchestration binding', () => {
  it('binds a live accessor that resolves a real upstream token from the store', async () => {
    const tokenStore = new InMemoryOrchestratedTokenStore({ encryptionKey: new Uint8Array(32).fill(7) });
    await tokenStore.storeTokens(deriveAuthorizationId(TOKEN), 'github', { accessToken: 'gh-upstream-token-xyz' });

    const contextTokens = await runCheckAuthorization({
      authOptions: { mode: 'local', providers: [{ id: 'github' }] },
      tokenStore,
    });

    const accessor = contextTokens.get(ORCHESTRATED_AUTH_ACCESSOR) as OrchestratedAuthAccessor | undefined;
    expect(accessor).toBeInstanceOf(OrchestratedAuthAccessorAdapter);
    expect(accessor?.isAuthenticated).toBe(true);
    expect(accessor?.hasProvider('github')).toBe(true);

    // The live accessor resolves the REAL decrypted upstream token.
    const token = await accessor!.getToken('github');
    expect(token).toBe('gh-upstream-token-xyz');
  });

  it('does NOT bind the accessor for a non-orchestrated (public) scope', async () => {
    const tokenStore = new InMemoryOrchestratedTokenStore({ encryptionKey: new Uint8Array(32).fill(7) });
    const contextTokens = await runCheckAuthorization({
      authOptions: { mode: 'public' },
      tokenStore,
    });
    expect(contextTokens.has(ORCHESTRATED_AUTH_ACCESSOR)).toBe(false);
  });

  it('does NOT bind the accessor when there is no token store', async () => {
    const contextTokens = await runCheckAuthorization({
      authOptions: { mode: 'local' },
      tokenStore: undefined,
    });
    expect(contextTokens.has(ORCHESTRATED_AUTH_ACCESSOR)).toBe(false);
  });

  it('does NOT bind the accessor for a tokenless (anonymous) request', async () => {
    const tokenStore = new InMemoryOrchestratedTokenStore({ encryptionKey: new Uint8Array(32).fill(7) });
    const contextTokens = await runCheckAuthorization({
      authOptions: { mode: 'local' },
      tokenStore,
      token: '',
    });
    expect(contextTokens.has(ORCHESTRATED_AUTH_ACCESSOR)).toBe(false);
  });
});
