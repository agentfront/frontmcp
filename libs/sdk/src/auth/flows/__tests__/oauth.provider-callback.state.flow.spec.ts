/**
 * OAuth Provider Callback — federated state nonce binding (security regression).
 *
 * The upstream `state` nonce (`federated:{sessionId}:{nonce}`) is the only
 * binding between a provider callback and the local federated session. It MUST
 * be verified in EVERY mode; previously `federatedAuth.stateValidation:'format'`
 * validated only the `federated:` prefix + arity, so a callback with the correct
 * format and a real session id but a WRONG nonce was accepted — letting an
 * attacker replay their own upstream code into a victim's session.
 */
import 'reflect-metadata';

import { InMemoryFederatedAuthSessionStore, type FederatedAuthSession } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { HttpHtmlSchema, httpInputSchema, HttpRedirectSchema, type FlowMetadata } from '../../../common';
import { LocalPrimaryAuth } from '../../instances/instance.local-primary-auth';
import OauthProviderCallbackFlow from '../oauth.provider-callback.flow';

function createMeta(): FlowMetadata<'oauth:provider-callback'> {
  const outputSchema = z.union([HttpRedirectSchema, HttpHtmlSchema]);
  return {
    name: 'oauth:provider-callback',
    plan: {
      pre: ['parseInput', 'handleConsentSubmission', 'loadFederatedSession', 'validateProviderCallback'],
      execute: ['exchangeProviderCode', 'storeProviderTokens', 'handleNextProviderOrComplete'],
    },
    inputSchema: httpInputSchema,
    outputSchema,
    access: 'public',
    middleware: { method: 'GET', path: '/oauth/provider/:providerId/callback' },
  } as FlowMetadata<'oauth:provider-callback'>;
}

const GOOD_NONCE_STATE = 'federated:sess-1:GOODNONCE';

async function seedSession(store: InMemoryFederatedAuthSessionStore): Promise<void> {
  const session: FederatedAuthSession = {
    id: 'sess-1',
    pendingAuthId: 'pending-1',
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:5000/cb',
    scopes: ['openid'],
    userInfo: { email: 'victim@example.com' },
    frontmcpPkce: { challenge: 'x'.repeat(43), method: 'S256' },
    providerQueue: [],
    completedProviders: new Map(),
    skippedProviders: [],
    currentProviderId: 'google',
    currentProviderState: GOOD_NONCE_STATE,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  await store.store(session);
}

/**
 * A `LocalPrimaryAuth`-typed stub (so the flow's `instanceof` guard passes) with
 * `federatedSessionStore` + `options` shadowing the prototype getters.
 */
function makeFakeLocalAuth(store: InMemoryFederatedAuthSessionStore, stateValidation: 'strict' | 'format') {
  const fakeAuth = Object.create(LocalPrimaryAuth.prototype) as object;
  Object.defineProperties(fakeAuth, {
    federatedSessionStore: { value: store, configurable: true },
    options: { value: { mode: 'local', federatedAuth: { stateValidation } }, configurable: true },
  });
  return fakeAuth;
}

/**
 * Build a scope whose auth is a real `LocalPrimaryAuth` prototype carrying the
 * federated session store + the given stateValidation mode.
 */
async function buildScope(stateValidation: 'strict' | 'format') {
  const store = new InMemoryFederatedAuthSessionStore();
  await seedSession(store);
  const scope = createMockScopeEntry({ auth: { mode: 'local' } as never });
  (scope as unknown as { auth: unknown }).auth = makeFakeLocalAuth(store, stateValidation);
  return scope;
}

function run(scope: unknown, providerState: string) {
  const input = createMockHttpRequest({
    method: 'GET',
    path: '/oauth/provider/google/callback',
    query: { state: providerState },
  });
  const flow = new OauthProviderCallbackFlow(createMeta(), input as never, scope as never, jest.fn(), new Map());
  return runFlowStages(flow, ['parseInput', 'loadFederatedSession']);
}

describe('OauthProviderCallbackFlow — federated state nonce binding', () => {
  it("rejects a wrong nonce even in stateValidation:'format' (previously accepted)", async () => {
    const scope = await buildScope('format');
    const { output } = await run(scope, 'federated:sess-1:WRONGNONCE');

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('Invalid state parameter');
  });

  it("rejects a wrong nonce in stateValidation:'strict' too", async () => {
    const scope = await buildScope('strict');
    const { output } = await run(scope, 'federated:sess-1:WRONGNONCE');

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
  });

  it('accepts the exact issued nonce (format mode) and proceeds', async () => {
    const scope = await buildScope('format');
    const { output, state } = await run(scope, GOOD_NONCE_STATE);

    // No respond — loadFederatedSession stored the session and fell through.
    expect(output).toBeUndefined();
    expect(state.federatedSession).toBeDefined();
  });

  it('rejects a well-formed state whose session has no issued nonce', async () => {
    const store = new InMemoryFederatedAuthSessionStore();
    const session: FederatedAuthSession = {
      id: 'sess-2',
      pendingAuthId: 'p',
      clientId: 'c',
      redirectUri: 'http://127.0.0.1:5000/cb',
      scopes: ['openid'],
      userInfo: {},
      frontmcpPkce: { challenge: 'x'.repeat(43), method: 'S256' },
      providerQueue: [],
      completedProviders: new Map(),
      skippedProviders: [],
      currentProviderId: 'google',
      currentProviderState: undefined, // no nonce issued
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    await store.store(session);
    const scope = createMockScopeEntry({ auth: { mode: 'local' } as never });
    (scope as unknown as { auth: unknown }).auth = makeFakeLocalAuth(store, 'format');

    const { output } = await run(scope, 'federated:sess-2:anything');
    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
  });
});
