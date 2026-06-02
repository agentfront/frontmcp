/**
 * OAuth Callback Flow — progressive/incremental authorization expansion.
 *
 * Verifies that an incremental authorize for app B:
 *  - computes the EXPANDED authorized-app grant (prior apps ∪ targetApp) in
 *    `handleIncrementalAuth`, and
 *  - threads that grant into `createAuthorizationCode` so the minted token's
 *    `authorized_apps` claim reflects the new (and prior) grant.
 *
 * And that the expansion is gated:
 *  - disabled `incrementalAuth` → NO expansion (no claim, default preserved),
 *  - non-incremental login → NO expansion,
 *  - unknown target app → NO expansion.
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

const APPS = [
  { id: 'notes', name: 'Notes' },
  { id: 'tasks', name: 'Tasks' },
];

/** Seed an INCREMENTAL pending authorization for app B carrying prior apps. */
async function seedIncrementalPending(
  scope: any,
  opts: { targetAppId: string; priorAuthorizedAppIds?: string[] },
): Promise<string> {
  const store = scope.auth.authorizationStore;
  const pkce = generatePkceChallenge('a'.repeat(64));
  const pending = store.createPendingRecord({
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:54321/callback',
    scopes: ['openid'],
    pkce,
    state: 'xyz',
    isIncremental: true,
    targetAppId: opts.targetAppId,
    priorAuthorizedAppIds: opts.priorAuthorizedAppIds,
  });
  await store.storePendingAuthorization(pending);
  return pending.id;
}

function makeCallback(scope: any, pendingAuthId: string, extraQuery: Record<string, string> = {}) {
  const input = createMockHttpRequest({
    method: 'GET',
    path: '/oauth/callback',
    query: { pending_auth_id: pendingAuthId, email: 'user@example.com', ...extraQuery },
  });
  return new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
}

describe('OAuth Callback Flow — incremental authorization expansion', () => {
  it('expands the grant to (prior ∪ target) when incrementalAuth is enabled', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'tasks',
      priorAuthorizedAppIds: ['notes'],
    });

    const flow = makeCallback(scope, pendingAuthId, { incremental: 'true', app_id: 'tasks' });
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth', 'handleIncrementalAuth']);

    expect(new Set(state.authorizedAppIds)).toEqual(new Set(['notes', 'tasks']));
  });

  it('threads the expanded grant into createAuthorizationCode (authorized_apps reflects the union)', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    // Capture the params passed to createAuthorizationCode.
    let captured: any;
    (scope.auth as any).createAuthorizationCode = jest.fn(async (params: any) => {
      captured = params;
      return 'minted-code';
    });

    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'tasks',
      priorAuthorizedAppIds: ['notes'],
    });

    const flow = makeCallback(scope, pendingAuthId, { incremental: 'true', app_id: 'tasks' });
    await runFlowStages(flow, [
      'parseInput',
      'validatePendingAuth',
      'handleIncrementalAuth',
      'handleFederatedAuth',
      'createAuthorizationCode',
    ]);

    expect(captured).toBeDefined();
    expect(new Set(captured.authorizedAppIds)).toEqual(new Set(['notes', 'tasks']));
  });

  it('drops unknown prior app ids (cannot forge a grant to a non-existent app)', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'tasks',
      priorAuthorizedAppIds: ['notes', 'ghost-app'],
    });

    const flow = makeCallback(scope, pendingAuthId, { incremental: 'true', app_id: 'tasks' });
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth', 'handleIncrementalAuth']);

    expect(new Set(state.authorizedAppIds)).toEqual(new Set(['notes', 'tasks']));
    expect(state.authorizedAppIds).not.toContain('ghost-app');
  });

  it('does NOT grant an unknown target app — falls back to the (valid) prior grant', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'ghost-app',
      priorAuthorizedAppIds: ['notes'],
    });

    const flow = makeCallback(scope, pendingAuthId, { incremental: 'true', app_id: 'ghost-app' });
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth', 'handleIncrementalAuth']);

    // The unknown app is NOT granted; the prior (real) grant is preserved.
    expect(new Set(state.authorizedAppIds)).toEqual(new Set(['notes']));
    expect(state.authorizedAppIds).not.toContain('ghost-app');
  });

  it('does NOT expand when incrementalAuth.enabled is false (default preserved)', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: false } } as any,
      apps: APPS,
    });
    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'tasks',
      priorAuthorizedAppIds: ['notes'],
    });

    const flow = makeCallback(scope, pendingAuthId, { incremental: 'true', app_id: 'tasks' });
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth', 'handleIncrementalAuth']);

    expect(state.authorizedAppIds).toBeUndefined();
  });

  it('initial login (incremental enabled) with apps= grants exactly the requested apps', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    const store = (scope.auth as any).authorizationStore;
    const pkce = generatePkceChallenge('a'.repeat(64));
    const pending = store.createPendingRecord({
      clientId: 'local-client',
      redirectUri: 'http://127.0.0.1:54321/callback',
      scopes: ['openid'],
      pkce,
      state: 'xyz',
      // Initial (non-incremental) login that narrows the grant via apps=.
      priorAuthorizedAppIds: ['notes'],
    });
    await store.storePendingAuthorization(pending);

    const flow = makeCallback(scope, pending.id);
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth', 'handleIncrementalAuth']);

    expect(new Set(state.authorizedAppIds)).toEqual(new Set(['notes']));
  });

  it('initial login (incremental enabled) with NO apps= grants ALL scope apps (allow-all preserved)', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    const store = (scope.auth as any).authorizationStore;
    const pkce = generatePkceChallenge('a'.repeat(64));
    const pending = store.createPendingRecord({
      clientId: 'local-client',
      redirectUri: 'http://127.0.0.1:54321/callback',
      scopes: ['openid'],
      pkce,
      state: 'xyz',
    });
    await store.storePendingAuthorization(pending);

    const flow = makeCallback(scope, pending.id);
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth', 'handleIncrementalAuth']);

    // Every scope app is granted, so app-level gating is effectively allow-all.
    expect(new Set(state.authorizedAppIds)).toEqual(new Set(['notes', 'tasks']));
  });

  it('emits NO grant when the scope has no incrementalAuth block at all (default preserved)', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local' } as any, // no incrementalAuth block
      apps: APPS,
    });
    const store = (scope.auth as any).authorizationStore;
    const pkce = generatePkceChallenge('a'.repeat(64));
    const pending = store.createPendingRecord({
      clientId: 'local-client',
      redirectUri: 'http://127.0.0.1:54321/callback',
      scopes: ['openid'],
      pkce,
      state: 'xyz',
    });
    await store.storePendingAuthorization(pending);

    const flow = makeCallback(scope, pending.id);
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth', 'handleIncrementalAuth']);

    expect(state.authorizedAppIds).toBeUndefined();
  });
});
