/**
 * OAuth Callback Flow Tests
 *
 * Focused coverage for the email-requirement opt-out at /oauth/callback (#468).
 * When `auth.requireEmail` is false, a single-operator local login should mint
 * an authorization code without an email by deriving a stable anonymous `sub`.
 * Default behavior (email required) must remain unchanged.
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
 * Seed a pending authorization in the scope's auth store and return its id.
 * The mock auth exposes a real InMemoryAuthorizationStore as `authorizationStore`.
 */
async function seedPendingAuth(scope: any): Promise<string> {
  const store = scope.auth.authorizationStore;
  const pkce = generatePkceChallenge('a'.repeat(64));
  const pending = store.createPendingRecord({
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:54321/callback',
    scopes: ['openid'],
    pkce,
    state: 'xyz',
  });
  await store.storePendingAuthorization(pending);
  return pending.id;
}

describe('OAuth Callback Flow — email opt-out (#468)', () => {
  it('rejects a non-incremental login with no email by default (requireEmail defaults to true)', async () => {
    const scope = createMockScopeEntry({ auth: { mode: 'local' } as any });
    const pendingAuthId = await seedPendingAuth(scope);

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      query: { pending_auth_id: pendingAuthId }, // no email
    });

    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);

    // Historical behavior: 400 HTML "Email is required"
    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('Email is required');
  });

  it('mints a code (no 400) without an email when requireEmail is false', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false, anonymousSubject: 'local-operator' } as any,
    });
    const pendingAuthId = await seedPendingAuth(scope);

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      query: { pending_auth_id: pendingAuthId }, // no email
    });

    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    const { output, state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);

    // No error page — validatePendingAuth completed and set a stable userSub.
    expect(output).toBeUndefined();
    expect(typeof state.userSub).toBe('string');
    expect(state.userSub.length).toBeGreaterThan(0);
    // clientId/redirectUri/codeChallenge are required to mint a code downstream.
    expect(state.clientId).toBe('local-client');
    expect(state.codeChallenge).toBeDefined();
  });

  it('derives a STABLE anonymous sub from anonymousSubject (deterministic across logins)', async () => {
    const mk = async () => {
      const scope = createMockScopeEntry({
        auth: { mode: 'local', requireEmail: false, anonymousSubject: 'operator-1' } as any,
      });
      const pendingAuthId = await seedPendingAuth(scope);
      const input = createMockHttpRequest({
        method: 'GET',
        path: '/oauth/callback',
        query: { pending_auth_id: pendingAuthId },
      });
      const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
      const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
      return state.userSub as string;
    };

    const subA = await mk();
    const subB = await mk();
    expect(subA).toBe(subB);

    // A different subject yields a different sub.
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false, anonymousSubject: 'operator-2' } as any,
    });
    const pendingAuthId = await seedPendingAuth(scope);
    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      query: { pending_auth_id: pendingAuthId },
    });
    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
    expect(state.userSub).not.toBe(subA);
  });

  it('still derives a sub from email when one is provided (requireEmail false does not override email)', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false } as any,
    });
    const pendingAuthId = await seedPendingAuth(scope);
    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      query: { pending_auth_id: pendingAuthId, email: 'user@example.com' },
    });
    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    const { output, state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
    expect(output).toBeUndefined();
    expect(typeof state.userSub).toBe('string');
  });
});
