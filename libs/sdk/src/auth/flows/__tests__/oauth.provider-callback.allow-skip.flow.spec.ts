/**
 * OAuth Provider Callback — `incrementalAuth.allowSkip: false` once every provider has answered.
 *
 * The picker already requires each app's own provider; a provider the user then declines at the provider must
 * refuse the sign-in the same way, rather than mint a token that leaves the app for later.
 */
import 'reflect-metadata';

import { InMemoryFederatedAuthSessionStore, type FederatedAuthSession } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { HttpHtmlSchema, httpInputSchema, HttpRedirectSchema, type FlowMetadata } from '../../../common';
import { LocalPrimaryAuth } from '../../instances/instance.local-primary-auth';
import OauthProviderCallbackFlow from '../oauth.provider-callback.flow';

function createMeta(): FlowMetadata<'oauth:provider-callback'> {
  return {
    name: 'oauth:provider-callback',
    plan: {
      pre: ['parseInput', 'handleConsentSubmission', 'loadFederatedSession', 'validateProviderCallback'],
      execute: ['exchangeProviderCode', 'storeProviderTokens', 'handleNextProviderOrComplete'],
    },
    inputSchema: httpInputSchema,
    outputSchema: z.union([HttpRedirectSchema, HttpHtmlSchema]),
    access: 'public',
    middleware: { method: 'GET', path: '/oauth/provider/:providerId/callback' },
  } as FlowMetadata<'oauth:provider-callback'>;
}

function answeredSession(skippedProviders: string[]): FederatedAuthSession {
  return {
    id: 'sess-1',
    pendingAuthId: 'pending-1',
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:5000/cb',
    scopes: ['openid'],
    userInfo: { email: 'ada@example.com' },
    frontmcpPkce: { challenge: 'x'.repeat(43), method: 'S256' },
    providerQueue: [],
    completedProviders: new Map([
      ['github', { providerId: 'github', tokens: { accessToken: 'gh' }, completedAt: Date.now() }],
    ]),
    skippedProviders,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

async function complete(session: FederatedAuthSession, allowSkip: boolean) {
  const authOptions = { mode: 'local', providers: [{ id: 'github' }], incrementalAuth: { enabled: true, allowSkip } };
  const scope = createMockScopeEntry({
    auth: authOptions as never,
    apps: [{ id: 'tasks', name: 'Tasks', auth: { mode: 'public' } as never }],
  });
  const createAuthorizationCode = jest.fn(async () => 'minted-code');
  const localAuth = Object.create(LocalPrimaryAuth.prototype) as object;
  Object.defineProperties(localAuth, {
    options: { value: authOptions, configurable: true },
    federatedSessionStore: { value: new InMemoryFederatedAuthSessionStore(), configurable: true },
    authorizationStore: { value: { deletePendingAuthorization: jest.fn() }, configurable: true },
    issuer: { value: 'http://localhost:3001', configurable: true },
    issuerFor: { value: () => 'http://localhost:3001', configurable: true },
    createAuthorizationCode: { value: createAuthorizationCode, configurable: true },
  });
  (scope as unknown as { auth: unknown }).auth = localAuth;

  const input = createMockHttpRequest({ method: 'GET', path: '/oauth/provider/tasks/callback' });
  const flow = new OauthProviderCallbackFlow(createMeta(), input as never, scope, jest.fn(), new Map());
  (flow as unknown as { state: { set(key: string, value: unknown): void } }).state.set('federatedSession', session);
  const { output } = await runFlowStages(flow, ['handleNextProviderOrComplete']);
  return { output, minted: createAuthorizationCode.mock.calls.length > 0 };
}

describe('OauthProviderCallbackFlow — incrementalAuth.allowSkip: false', () => {
  it("refuses the sign-in when the user declined an app's own provider", async () => {
    const { output, minted } = await complete(answeredSession(['tasks']), false);

    expect(minted).toBe(false);
    expect(output?.status).toBe(400);
  });

  it('mints when the declined provider may be skipped', async () => {
    const { output, minted } = await complete(answeredSession(['tasks']), true);

    expect(minted).toBe(true);
    expect(output?.kind).toBe('redirect');
  });
});
