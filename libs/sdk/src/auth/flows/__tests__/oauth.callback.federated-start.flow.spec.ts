/**
 * OAuth Callback Flow — starting the provider chain after the picker.
 *
 * A selection that names a provider this server cannot sign in to upstream is refused, whatever its
 * order, so it can never end in a plain code with the selected providers never linked.
 */
import 'reflect-metadata';

import { generatePkceChallenge, InMemoryFederatedAuthSessionStore } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { bindSignin, signinCookie } from '../../../__test-utils__/helpers/oauth-flow.helpers';
import { HttpHtmlSchema, httpInputSchema, HttpRedirectSchema, type FlowMetadata } from '../../../common';
import OauthCallbackFlow from '../oauth.callback.flow';

const STAGES = [
  'parseInput',
  'validatePendingAuth',
  'handleIncrementalAuth',
  'handleFederatedAuth',
  'createAuthorizationCode',
];

function createCallbackMetadata(): FlowMetadata<'oauth:callback'> {
  return {
    name: 'oauth:callback',
    plan: { pre: ['parseInput', 'validatePendingAuth'], execute: STAGES.slice(2) },
    inputSchema: httpInputSchema,
    outputSchema: z.union([HttpRedirectSchema, HttpHtmlSchema]),
    access: 'public',
    middleware: { method: 'GET', path: '/oauth/callback' },
  } as FlowMetadata<'oauth:callback'>;
}

/** A scope whose auth can sign in upstream to `configured` only. */
function scopeWith(auth: Record<string, unknown>, configured: string[]) {
  const scope = createMockScopeEntry({
    auth: auth as any,
    apps: [
      { id: 'notes', name: 'Notes' },
      { id: 'tasks', name: 'Tasks', auth: { mode: 'public' } as any },
    ],
  }) as any;
  const createAuthorizationCode = jest.fn(async () => 'minted-code');
  Object.assign(scope.auth, {
    federatedSessionStore: new InMemoryFederatedAuthSessionStore(),
    getProviderConfig: (id: string) => (configured.includes(id) ? { id } : undefined),
    buildProviderAuthorizeUrl: async (id: string) => `https://${id}.idp.example/authorize`,
    createAuthorizationCode,
  });
  return { scope, createAuthorizationCode };
}

async function runPicker(scope: any, providerIds: string[], selected: string[]) {
  const store = scope.auth.authorizationStore;
  const pending = store.createPendingRecord({
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:54321/callback',
    scopes: ['openid'],
    pkce: generatePkceChallenge('a'.repeat(64)),
    state: 'xyz',
    federatedLogin: { providerIds, selectedProviderIds: undefined, skippedProviderIds: undefined },
  });
  await store.storePendingAuthorization(bindSignin(pending, pending.id));
  const input = createMockHttpRequest({
    method: 'GET',
    path: '/oauth/callback',
    query: { pending_auth_id: pending.id, federated: 'true', email: 'user@example.com', providers: selected } as any,
    headers: { cookie: signinCookie(pending.id) },
  });
  const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
  return runFlowStages(flow, STAGES);
}

describe('OAuth Callback Flow — starting the provider chain', () => {
  const declaredProviders = { mode: 'local', providers: [{ id: 'github' }, { id: 'slack' }] };

  it('refuses a selection that puts a provider with no upstream sign-in first, instead of minting a code', async () => {
    const { scope, createAuthorizationCode } = scopeWith(declaredProviders, ['github', 'slack']);

    const { output } = await runPicker(scope, ['github', 'slack', 'tasks'], ['tasks', 'github']);

    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('tasks cannot be linked on this server');
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });

  it('starts with the first configured provider', async () => {
    const { scope, createAuthorizationCode } = scopeWith(declaredProviders, ['github', 'slack']);

    const { output } = await runPicker(scope, ['github', 'slack'], ['slack', 'github']);

    expect(output?.kind).toBe('redirect');
    expect(output?.location).toBe('https://slack.idp.example/authorize');
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });

  it('signs in to a registered app provider selected after the server sign-in', async () => {
    const { scope, createAuthorizationCode } = scopeWith({ mode: 'local' }, ['tasks']);

    const { output } = await runPicker(scope, ['__parent__', 'tasks'], ['__parent__', 'tasks']);

    expect(output?.kind).toBe('redirect');
    expect(output?.location).toBe('https://tasks.idp.example/authorize');
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });

  it('keeps the app-level picker minting a code when no selected provider signs in upstream', async () => {
    const { scope, createAuthorizationCode } = scopeWith({ mode: 'local' }, []);

    const { output, state } = await runPicker(scope, ['__parent__', 'tasks'], ['__parent__', 'tasks']);

    expect(output).toBeUndefined();
    expect(state.isFederated).toBe(false);
    expect(createAuthorizationCode).toHaveBeenCalledTimes(1);
  });
});
