/**
 * HTTP Request Flow — `this.orchestration` request-scoped binding.
 *
 * Verifies that the `checkAuthorization` stage binds ORCHESTRATED_AUTH_ACCESSOR
 * to a live OrchestratedAuthAccessorAdapter when the verified authorization is
 * an OrchestratedAuthorization, so a tool's `this.orchestration.getToken(id)`
 * resolves a REAL upstream token (not the Null fallback). Non-orchestrated
 * authorizations must leave the token unbound.
 */
import 'reflect-metadata';

import {
  deriveAuthorizationId,
  InMemoryOrchestratedTokenStore,
  ORCHESTRATED_AUTH_ACCESSOR,
  OrchestratedAuthAccessorAdapter,
  OrchestratedAuthorization,
  PublicAuthorization,
  type OrchestratedAuthAccessor,
} from '@frontmcp/auth';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpInputSchema, httpOutputSchema, type FlowMetadata } from '../../../common';
import HttpRequestFlow from '../http.request.flow';

const TOKEN = 'local-jwt-token-orchestration-test';

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
 * Build a real OrchestratedAuthorization backed by an in-memory token store that
 * already holds a github token for this authorization id.
 */
async function buildOrchestratedAuthorization(): Promise<OrchestratedAuthorization> {
  const tokenStore = new InMemoryOrchestratedTokenStore({ encryptionKey: new Uint8Array(32).fill(7) });
  const authId = deriveAuthorizationId(TOKEN);
  await tokenStore.storeTokens(authId, 'github', { accessToken: 'gh-upstream-token-xyz' });

  return OrchestratedAuthorization.create({
    token: TOKEN,
    user: { sub: 'user-1', name: 'Alice' },
    primaryProviderId: 'github',
    tokenStore,
    providers: { github: { id: 'github' } },
  });
}

/**
 * Run the `checkAuthorization` stage with session:verify stubbed to return the
 * given authorization, and a fake FrontMcpContext that records context tokens.
 * Returns the captured context-token map.
 */
async function runCheckAuthorization(authorization: unknown): Promise<Map<unknown, unknown>> {
  const contextTokens = new Map<unknown, unknown>();
  const fakeContext = {
    updateAuthInfo: jest.fn(),
    setContextToken: (token: unknown, instance: unknown) => contextTokens.set(token, instance),
    getContextTokens: () => new Map(contextTokens),
    requestId: 'req-test',
  };
  const fakeStorage = { getStore: () => fakeContext, getStoreOrThrow: () => fakeContext };

  const scope = createMockScopeEntry({ auth: { mode: 'local' } as never });
  // session:verify returns the (already verified) authorization.
  (scope.runFlow as jest.Mock).mockResolvedValue({ kind: 'authorized', authorization });
  // tryGetContext() resolves the context storage from scope.providers. The
  // checkAuthorization stage only resolves the FrontMcpContextStorage token, so
  // returning the fake storage for any token is sufficient (and avoids relying
  // on cross-module token identity in the test runner).
  (scope.providers.get as jest.Mock).mockReturnValue(fakeStorage);

  const input = createMockHttpRequest({ method: 'POST', path: '/' });
  const flow = new HttpRequestFlow(createHttpRequestMetadata(), input as never, scope, jest.fn(), new Map());
  await runFlowStages(flow, ['checkAuthorization']);

  return contextTokens;
}

describe('HTTP Request Flow — this.orchestration binding', () => {
  it('binds ORCHESTRATED_AUTH_ACCESSOR to a live accessor that resolves a real upstream token', async () => {
    const authorization = await buildOrchestratedAuthorization();
    const contextTokens = await runCheckAuthorization(authorization);

    const accessor = contextTokens.get(ORCHESTRATED_AUTH_ACCESSOR) as OrchestratedAuthAccessor | undefined;
    expect(accessor).toBeInstanceOf(OrchestratedAuthAccessorAdapter);
    expect(accessor?.isAuthenticated).toBe(true);
    expect(accessor?.hasProvider('github')).toBe(true);

    // The live accessor resolves the REAL decrypted upstream token.
    const token = await accessor!.getToken('github');
    expect(token).toBe('gh-upstream-token-xyz');
  });

  it('does NOT bind the accessor for a non-orchestrated (public) authorization', async () => {
    const publicAuth = PublicAuthorization.create({ scopes: ['anonymous'], ttlMs: 3600000, issuer: 'http://x' });
    const contextTokens = await runCheckAuthorization(publicAuth);

    expect(contextTokens.has(ORCHESTRATED_AUTH_ACCESSOR)).toBe(false);
  });
});
