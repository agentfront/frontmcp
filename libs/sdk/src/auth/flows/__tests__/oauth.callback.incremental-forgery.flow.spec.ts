/**
 * OAuth Callback Flow — the incremental-authorization forgery gate.
 *
 * GHSA-2c4g-9c8x-6m8g. `auth.mode: 'local'` makes the app's `authenticate()`
 * callback the credential boundary, and an incremental authorization is the one
 * path that skips it. That decision therefore has to come from the pending
 * record the server itself wrote — never from the request.
 *
 * Mirrors the shape of `oauth.callback.federated-gate.flow.spec.ts`, which is
 * the sibling flag that was always validated correctly.
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

/** A local scope whose `authenticate()` only accepts one secret. */
function createVerifierScope(
  authenticate = jest.fn(async (input: { fields: Record<string, string> }) =>
    input.fields['apiKey'] === 'good'
      ? { ok: true as const, sub: 'operator' }
      : { ok: false as const, message: 'Invalid API key' },
  ),
) {
  const scope = createMockScopeEntry({
    auth: {
      mode: 'local',
      requireEmail: false,
      anonymousSubject: 'local-operator',
      login: { fields: { apiKey: { type: 'password', label: 'API Key', required: true } } },
      authenticate,
    } as any,
  });
  return { scope, authenticate };
}

async function seedPending(scope: any, overrides: Record<string, unknown> = {}): Promise<string> {
  const store = scope.auth.authorizationStore;
  const pending = store.createPendingRecord({
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:54321/callback',
    scopes: ['openid'],
    pkce: generatePkceChallenge('a'.repeat(64)),
    state: 'xyz',
    ...overrides,
  });
  await store.storePendingAuthorization(pending);
  return pending.id;
}

function runCallback(scope: any, query: Record<string, string>) {
  const input = createMockHttpRequest({ method: 'GET', path: '/oauth/callback', query: query as any });
  const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
  return runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
}

describe('OAuth Callback Flow — incremental forgery gate', () => {
  it('runs authenticate() even when the request claims incremental=true', async () => {
    const { scope, authenticate } = createVerifierScope();
    const pendingAuthId = await seedPending(scope);

    const { state } = await runCallback(scope, { pending_auth_id: pendingAuthId, incremental: 'true' });

    // The verifier ran, was given no credential, and refused.
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(state.isIncremental).toBe(false);
    expect(state.userSub).toBeUndefined();
  });

  it('re-renders the login page instead of minting for a credential-free incremental claim', async () => {
    const { scope } = createVerifierScope();
    const pendingAuthId = await seedPending(scope);

    const { output } = await runCallback(scope, {
      pending_auth_id: pendingAuthId,
      incremental: 'true',
      app_id: 'notes',
    });

    expect(output?.kind).toBe('html');
    expect(String(output?.body)).toContain('Invalid API key');
  });

  it('does not let a request set targetAppId on a non-incremental record', async () => {
    const { scope } = createVerifierScope();
    const pendingAuthId = await seedPending(scope);

    const { state } = await runCallback(scope, {
      pending_auth_id: pendingAuthId,
      incremental: 'true',
      app_id: 'tasks',
      apiKey: 'good',
    });

    expect(state.isIncremental).toBe(false);
    expect(state.targetAppId).toBeUndefined();
  });

  it('ignores a server-side incremental record that carries no proven subject', async () => {
    // A half-formed record (isIncremental without incrementalSub) must not be
    // enough to skip the gate — there would be no verified identity to mint for.
    const { scope, authenticate } = createVerifierScope();
    const pendingAuthId = await seedPending(scope, { isIncremental: true, targetAppId: 'tasks' });

    const { state } = await runCallback(scope, { pending_auth_id: pendingAuthId });

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(state.isIncremental).toBe(false);
  });

  it('skips the gate and mints for the PROVEN subject on a genuine incremental record', async () => {
    const { scope, authenticate } = createVerifierScope();
    const pendingAuthId = await seedPending(scope, {
      isIncremental: true,
      incrementalSub: 'proven-subject',
      targetAppId: 'tasks',
    });

    const { output, state } = await runCallback(scope, { pending_auth_id: pendingAuthId });

    expect(output).toBeUndefined();
    expect(authenticate).not.toHaveBeenCalled();
    expect(state.isIncremental).toBe(true);
    expect(state.targetAppId).toBe('tasks');
    // Crucially NOT the anonymous subject the bypass used to mint.
    expect(state.userSub).toBe('proven-subject');
  });

  it('still completes an ordinary login with the correct credential', async () => {
    const { scope, authenticate } = createVerifierScope();
    const pendingAuthId = await seedPending(scope);

    const { output, state } = await runCallback(scope, { pending_auth_id: pendingAuthId, apiKey: 'good' });

    expect(output).toBeUndefined();
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(state.userSub).toBe('operator');
  });
});
