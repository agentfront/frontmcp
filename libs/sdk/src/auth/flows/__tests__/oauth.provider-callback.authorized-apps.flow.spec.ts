/**
 * OAuth Provider Callback — the `authorized_apps` grant a federated sign-in mints.
 *
 * With `incrementalAuth` enabled the tool gate refuses a token without `authorized_apps`, so the code minted once
 * every provider is linked must carry the grant: the picker's, without the apps whose provider was declined.
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

const APPS = [
  { id: 'notes', name: 'Notes' },
  { id: 'tasks', name: 'Tasks', auth: { mode: 'public' } },
];

function completedSession(overrides: Partial<FederatedAuthSession>): FederatedAuthSession {
  return {
    id: 'sess-1',
    pendingAuthId: 'pending-1',
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:5000/cb',
    scopes: ['openid'],
    userInfo: { email: 'ada@example.com', name: 'Ada Lovelace' },
    frontmcpPkce: { challenge: 'x'.repeat(43), method: 'S256' },
    providerQueue: [],
    completedProviders: new Map([
      ['github', { providerId: 'github', tokens: { accessToken: 'gh' }, completedAt: Date.now() }],
    ]),
    skippedProviders: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

async function complete(session: FederatedAuthSession, authOptions: Record<string, unknown>) {
  const scope = createMockScopeEntry({ auth: authOptions as never, apps: APPS });
  const createAuthorizationCode = jest.fn(async (_params: { authorizedAppIds?: string[] }) => 'minted-code');
  const localAuth = Object.create(LocalPrimaryAuth.prototype) as object;
  Object.defineProperties(localAuth, {
    options: { value: authOptions, configurable: true },
    federatedSessionStore: { value: new InMemoryFederatedAuthSessionStore(), configurable: true },
    issuer: { value: 'http://localhost:3001', configurable: true },
    issuerFor: { value: () => 'http://localhost:3001', configurable: true },
    createAuthorizationCode: { value: createAuthorizationCode, configurable: true },
  });
  (scope as unknown as { auth: unknown }).auth = localAuth;

  const input = createMockHttpRequest({ method: 'GET', path: '/oauth/provider/github/callback' });
  const flow = new OauthProviderCallbackFlow(createMeta(), input as never, scope, jest.fn(), new Map());
  (flow as unknown as { state: { set(key: string, value: unknown): void } }).state.set('federatedSession', session);
  const { output } = await runFlowStages(flow, ['handleNextProviderOrComplete']);
  return { output, minted: createAuthorizationCode.mock.calls[0]?.[0] };
}

describe('OauthProviderCallbackFlow — authorized_apps of a federated sign-in', () => {
  const INCREMENTAL = { mode: 'local', incrementalAuth: { enabled: true } };

  it('mints the grant the picker computed', async () => {
    const { output, minted } = await complete(completedSession({ authorizedAppIds: ['notes', 'tasks'] }), INCREMENTAL);

    expect(output?.kind).toBe('redirect');
    expect(minted?.authorizedAppIds).toEqual(['notes', 'tasks']);
  });

  it('leaves out an app whose provider was declined', async () => {
    const { minted } = await complete(
      completedSession({ authorizedAppIds: ['notes', 'tasks'], skippedProviders: ['tasks'] }),
      INCREMENTAL,
    );

    expect(minted?.authorizedAppIds).toEqual(['notes']);
  });

  it('grants every app to a session that carries no grant, such as remote mode', async () => {
    const { minted } = await complete(completedSession({}), INCREMENTAL);

    expect(new Set(minted?.authorizedAppIds)).toEqual(new Set(['notes', 'tasks']));
  });

  it('mints no grant when incremental auth is off', async () => {
    const { minted } = await complete(completedSession({}), { mode: 'local' });

    expect(minted).toBeDefined();
    expect(minted?.authorizedAppIds).toBeUndefined();
  });
});
