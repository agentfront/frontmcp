/**
 * OAuth Callback Flow — federated JWT gating (multi-provider orchestration).
 *
 * Verifies that the callback refuses to mint an authorization code until the
 * configured provider threshold is satisfied:
 * - default minimum of 1 (no JWT until ≥1 linked),
 * - `federatedAuth.minProviders` raises the threshold,
 * - `federatedAuth.requiredProviders` must all be among the selected set,
 * - selecting enough (and all required) providers passes the gate.
 */
import 'reflect-metadata';

import { generatePkceChallenge } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { HttpHtmlSchema, httpInputSchema, HttpRedirectSchema, type FlowMetadata } from '../../../common';
import OauthCallbackFlow from '../oauth.callback.flow';

function createCallbackMetadata(): FlowMetadata<'oauth:callback'> {
  const outputSchema = z.union([HttpRedirectSchema, HttpHtmlSchema]);
  return {
    name: 'oauth:callback',
    plan: {
      pre: ['parseInput', 'validatePendingAuth'],
      execute: ['handleIncrementalAuth', 'handleFederatedAuth', 'createAuthorizationCode', 'redirectToClient'],
    },
    inputSchema: httpInputSchema,
    outputSchema,
    access: 'public',
    middleware: { method: 'GET', path: '/oauth/callback' },
  } as FlowMetadata<'oauth:callback'>;
}

/**
 * Seed a federated pending authorization whose allowed providerIds are the
 * declared upstream providers.
 */
async function seedFederatedPendingAuth(scope: any, providerIds: string[]): Promise<string> {
  const store = scope.auth.authorizationStore;
  const pkce = generatePkceChallenge('a'.repeat(64));
  const pending = store.createPendingRecord({
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:54321/callback',
    scopes: ['openid'],
    pkce,
    state: 'xyz',
    federatedLogin: {
      providerIds,
      selectedProviderIds: undefined,
      skippedProviderIds: undefined,
    },
  });
  await store.storePendingAuthorization(pending);
  return pending.id;
}

function runCallback(scope: any, pendingAuthId: string, selected: string[] | undefined) {
  const query: Record<string, string | string[]> = {
    pending_auth_id: pendingAuthId,
    federated: 'true',
    email: 'user@example.com',
  };
  if (selected !== undefined) {
    query['providers'] = selected;
  }
  const input = createMockHttpRequest({ method: 'GET', path: '/oauth/callback', query: query as any });
  const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
  return runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
}

describe('OAuth Callback Flow — federated JWT gating', () => {
  it('refuses to mint a JWT when no providers are linked (default min 1)', async () => {
    const scope = createMockScopeEntry({
      auth: {
        mode: 'local',
        providers: [{ id: 'github' }, { id: 'slack' }],
      } as any,
    });
    const pendingAuthId = await seedFederatedPendingAuth(scope, ['github', 'slack']);

    const { output } = await runCallback(scope, pendingAuthId, []);

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('At least 1 provider');
  });

  it('refuses to mint a JWT when fewer than minProviders are linked', async () => {
    const scope = createMockScopeEntry({
      auth: {
        mode: 'local',
        providers: [{ id: 'github' }, { id: 'slack' }],
        federatedAuth: { stateValidation: 'strict', minProviders: 2 },
      } as any,
    });
    const pendingAuthId = await seedFederatedPendingAuth(scope, ['github', 'slack']);

    const { output } = await runCallback(scope, pendingAuthId, ['github']);

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('At least 2 providers');
  });

  it('refuses to mint a JWT when a required provider is missing', async () => {
    const scope = createMockScopeEntry({
      auth: {
        mode: 'local',
        providers: [{ id: 'github' }, { id: 'slack' }],
        federatedAuth: { stateValidation: 'strict', requiredProviders: ['github'] },
      } as any,
    });
    const pendingAuthId = await seedFederatedPendingAuth(scope, ['github', 'slack']);

    // Only slack selected — github is required but missing.
    const { output } = await runCallback(scope, pendingAuthId, ['slack']);

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('Required provider(s) not linked: github');
  });

  it('passes the gate when min and required thresholds are satisfied', async () => {
    const scope = createMockScopeEntry({
      auth: {
        mode: 'local',
        providers: [{ id: 'github' }, { id: 'slack' }],
        federatedAuth: { stateValidation: 'strict', minProviders: 1, requiredProviders: ['github'] },
      } as any,
    });
    const pendingAuthId = await seedFederatedPendingAuth(scope, ['github', 'slack']);

    const { output, state } = await runCallback(scope, pendingAuthId, ['github']);

    // No error page — the gate passed and userSub/selectedProviders were set.
    expect(output).toBeUndefined();
    expect(state.selectedProviders).toEqual(['github']);
    expect(typeof state.userSub).toBe('string');
  });

  it('rejects a provider not in the allowed providerIds set', async () => {
    const scope = createMockScopeEntry({
      auth: {
        mode: 'local',
        providers: [{ id: 'github' }],
      } as any,
    });
    const pendingAuthId = await seedFederatedPendingAuth(scope, ['github']);

    const { output } = await runCallback(scope, pendingAuthId, ['evil-provider']);

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('Invalid provider selection');
  });

  it('keeps the historical ≥1 behavior on the app-level federation path (no configured providers)', async () => {
    const scope = createMockScopeEntry({
      // No top-level providers — legacy app-level federation.
      auth: { mode: 'local' } as any,
    });
    const pendingAuthId = await seedFederatedPendingAuth(scope, ['__parent__', 'slack']);

    const { output } = await runCallback(scope, pendingAuthId, []);

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('At least 1 provider');
  });
});
