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

describe('OAuth Callback Flow — custom authenticate() (Checkpoint 3a)', () => {
  it('on ok:true derives sub + stashes custom claims and proceeds (no email required)', async () => {
    const authenticate = jest.fn().mockResolvedValue({
      ok: true,
      sub: 'verified-user-1',
      claims: { tenantId: 'acme', plan: 'pro' },
    });
    const scope = createMockScopeEntry({
      auth: { mode: 'local', authenticate } as any,
    });
    const pendingAuthId = await seedPendingAuth(scope);

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      // No email — authenticate() bypasses the email requirement.
      query: { pending_auth_id: pendingAuthId, apiKey: 'secret-123' },
    });

    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    const { output, state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);

    // Verifier was called with the submitted (non-reserved) login fields.
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate.mock.calls[0][0]).toEqual({ fields: { apiKey: 'secret-123' } });
    // No error page; sub comes from the verifier; claims are stashed for the token.
    expect(output).toBeUndefined();
    expect(state.userSub).toBe('verified-user-1');
    expect(state.customClaims).toEqual({ tenantId: 'acme', plan: 'pro' });
  });

  it('excludes reserved OAuth/flow-control params from the fields passed to authenticate()', async () => {
    const authenticate = jest.fn().mockResolvedValue({ ok: true, sub: 'u2' });
    const scope = createMockScopeEntry({ auth: { mode: 'local', authenticate } as any });
    const pendingAuthId = await seedPendingAuth(scope);

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      query: {
        pending_auth_id: pendingAuthId,
        // Reserved OAuth / flow-control params that must NOT reach the verifier.
        scope: 'read',
        client_id: 'x',
        redirect_uri: 'http://x/cb',
        code: 'abc',
        csrf: 'c',
        // A legitimate custom login field.
        apiKey: 'k',
      },
    });
    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);

    const fields = authenticate.mock.calls[0][0].fields as Record<string, string>;
    expect(fields).toEqual({ apiKey: 'k' });
    expect(fields['scope']).toBeUndefined();
    expect(fields['client_id']).toBeUndefined();
    expect(fields['redirect_uri']).toBeUndefined();
    expect(fields['code']).toBeUndefined();
    expect(fields['pending_auth_id']).toBeUndefined();
  });

  it('on ok:false re-renders the login page with the error message (does not proceed)', async () => {
    const authenticate = jest.fn().mockResolvedValue({ ok: false, message: 'Invalid API key', retryField: 'apiKey' });
    const scope = createMockScopeEntry({
      auth: {
        mode: 'local',
        authenticate,
        login: { fields: { apiKey: { type: 'password', label: 'API Key' } } },
      } as any,
    });
    const pendingAuthId = await seedPendingAuth(scope);

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      query: { pending_auth_id: pendingAuthId, apiKey: 'wrong' },
    });
    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    const { output, state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);

    // The flow responds with the re-rendered login page (HTML 200), not a redirect.
    expect(output?.kind).toBe('html');
    expect(String(output?.body)).toContain('Invalid API key');
    expect(String(output?.body)).toContain('name="apiKey"');
    // Submitted value is preserved on the re-render.
    expect(String(output?.body)).toContain('value="wrong"');
    // No subject derived — login did not complete.
    expect(state.userSub).toBeUndefined();
  });

  it('derives sub from the per-account subject strategy when no explicit sub is returned', async () => {
    const authenticate = jest.fn().mockResolvedValue({ ok: true }); // no sub
    const mk = async () => {
      const scope = createMockScopeEntry({
        auth: {
          mode: 'local',
          authenticate,
          login: { subject: { fromField: 'account', strategy: 'per-account' } },
        } as any,
      });
      const pendingAuthId = await seedPendingAuth(scope);
      const input = createMockHttpRequest({
        method: 'GET',
        path: '/oauth/callback',
        query: { pending_auth_id: pendingAuthId, account: 'acct-42' },
      });
      const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
      const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
      return state.userSub as string;
    };
    const subA = await mk();
    const subB = await mk();
    // Same account → same stable sub.
    expect(subA).toBeTruthy();
    expect(subB).toBe(subA);
  });

  it('captures credentials returned by authenticate() into flow state (Checkpoint 3b)', async () => {
    const authenticate = jest.fn().mockResolvedValue({
      ok: true,
      sub: 'cred-user-1',
      credentials: [
        { key: 'acme', secret: 'sk-acme', metadata: { region: 'us' } },
        // Malformed entries must be dropped.
        { key: 'bad' }, // no secret
        { secret: 'orphan' }, // no key
      ],
    });
    const scope = createMockScopeEntry({ auth: { mode: 'local', authenticate } as any });
    const pendingAuthId = await seedPendingAuth(scope);

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      query: { pending_auth_id: pendingAuthId, apiKey: 'k' },
    });
    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);

    // Only the well-formed credential is captured for downstream persistence.
    expect(state.credentials).toEqual([{ key: 'acme', secret: 'sk-acme', metadata: { region: 'us' } }]);
  });

  it('a throwing verifier is handled cleanly (re-render, no crash)', async () => {
    const authenticate = jest.fn().mockRejectedValue(new Error('upstream down'));
    const scope = createMockScopeEntry({ auth: { mode: 'local', authenticate } as any });
    const pendingAuthId = await seedPendingAuth(scope);
    const input = createMockHttpRequest({
      method: 'GET',
      path: '/oauth/callback',
      query: { pending_auth_id: pendingAuthId, apiKey: 'k' },
    });
    const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
    // Falls back to a generic failure page, never a 500/throw.
    expect(output?.kind).toBe('html');
    expect(String(output?.body)).toContain('Authentication failed');
  });
});
