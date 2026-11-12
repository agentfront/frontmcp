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

import {
  generatePkceChallenge,
  InMemoryFederatedAuthSessionStore,
  sealPendingLogin,
  SessionCredentialVault,
} from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import { MemoryStorageAdapter } from '@frontmcp/utils';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { bindSignin, signinCookie } from '../../../__test-utils__/helpers/oauth-flow.helpers';
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
  opts: {
    targetAppId: string;
    priorAuthorizedAppIds?: string[];
    ticketProfile?: { email?: string; name?: string };
    federatedProviderIds?: string[];
    consentToolIds?: string[];
  },
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
    // The subject the authorize flow proved via the signed ticket. The callback
    // only treats a record as incremental when this is present, because it is
    // the identity the credential-free code will be minted for.
    incrementalSub: 'user-1',
    targetAppId: opts.targetAppId,
    priorAuthorizedAppIds: opts.priorAuthorizedAppIds,
    federatedLogin: opts.federatedProviderIds
      ? { providerIds: opts.federatedProviderIds, selectedProviderIds: undefined, skippedProviderIds: undefined }
      : undefined,
    consent: opts.consentToolIds
      ? { enabled: true, availableToolIds: opts.consentToolIds, selectedToolIds: undefined, consentCompleted: false }
      : undefined,
  });
  if (opts.ticketProfile) {
    pending.verifiedLogin = sealPendingLogin(scope.auth.secret, pending.id, { sub: 'user-1', ...opts.ticketProfile });
  }
  await store.storePendingAuthorization(bindSignin(pending, pending.id));
  return pending.id;
}

/** Capture what the callback passes to createAuthorizationCode. */
function captureMint(scope: any): { params?: any } {
  const captured: { params?: any } = {};
  scope.auth.createAuthorizationCode = jest.fn(async (params: any) => {
    captured.params = params;
    return 'minted-code';
  });
  return captured;
}

const MINT_STAGES = [
  'parseInput',
  'validatePendingAuth',
  'handleIncrementalAuth',
  'handleFederatedAuth',
  'createAuthorizationCode',
];

function makeCallback(scope: any, pendingAuthId: string, extraQuery: Record<string, string> = {}) {
  const input = createMockHttpRequest({
    method: 'GET',
    path: '/oauth/callback',
    query: { pending_auth_id: pendingAuthId, email: 'user@example.com', ...extraQuery },
    headers: { cookie: signinCookie(pendingAuthId) },
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

  it('keeps the subject session vault: an incremental authorize is the same session', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.connect();
    const vault = new SessionCredentialVault({ storage: adapter, pepper: 'incremental-vault-pepper-32-bytes' });
    const sessionVaultId = await vault.ensureVault('user-1');
    await vault.store('user-1', sessionVaultId, 'github', { secret: 'gh-token' });
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    Object.assign(scope.auth, { credentialVault: vault, createAuthorizationCode: jest.fn(async () => 'minted-code') });
    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'tasks',
      priorAuthorizedAppIds: ['notes'],
    });

    const flow = makeCallback(scope, pendingAuthId, { incremental: 'true', app_id: 'tasks' });
    const { state } = await runFlowStages(flow, [
      'parseInput',
      'validatePendingAuth',
      'handleIncrementalAuth',
      'handleFederatedAuth',
      'createAuthorizationCode',
    ]);

    expect(state.authorizationCode).toBe('minted-code');
    expect(await vault.getVaultId('user-1')).toBe(sessionVaultId);
    expect(await vault.get('user-1', 'github')).toEqual({ secret: 'gh-token' });
    await adapter.disconnect();
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
    await store.storePendingAuthorization(bindSignin(pending, pending.id));

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
    await store.storePendingAuthorization(bindSignin(pending, pending.id));

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
    await store.storePendingAuthorization(bindSignin(pending, pending.id));

    const flow = makeCallback(scope, pending.id);
    const { state } = await runFlowStages(flow, ['parseInput', 'validatePendingAuth', 'handleIncrementalAuth']);

    expect(state.authorizedAppIds).toBeUndefined();
  });

  it('keeps the email and name the ticket proved, not the ones submitted with the form', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    const minted = captureMint(scope);
    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'tasks',
      priorAuthorizedAppIds: ['notes'],
      ticketProfile: { email: 'ada@example.com', name: 'Ada Lovelace' },
    });

    await runFlowStages(makeCallback(scope, pendingAuthId, { name: 'Someone Else' }), MINT_STAGES);

    expect(minted.params.userSub).toBe('user-1');
    expect(minted.params.userEmail).toBe('ada@example.com');
    expect(minted.params.userName).toBe('Ada Lovelace');
  });

  it('mints no email the ticket did not carry, whatever the form submits', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: APPS,
    });
    const minted = captureMint(scope);
    const pendingAuthId = await seedIncrementalPending(scope, { targetAppId: 'tasks' });

    await runFlowStages(makeCallback(scope, pendingAuthId), MINT_STAGES);

    expect(minted.params.userEmail).toBeUndefined();
    expect(minted.params.userName).toBeUndefined();
  });

  it('expands the grant in a scope whose sign-in goes through the provider picker', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: [APPS[0], { ...APPS[1], auth: { mode: 'public' } }],
    });
    const minted = captureMint(scope);
    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'tasks',
      priorAuthorizedAppIds: ['notes'],
      federatedProviderIds: ['__parent__', 'tasks'],
    });

    await runFlowStages(makeCallback(scope, pendingAuthId), MINT_STAGES);

    expect(new Set(minted.params.authorizedAppIds)).toEqual(new Set(['notes', 'tasks']));
  });
});

describe('OAuth Callback Flow — authorized_apps of a sign-in through the provider picker', () => {
  const PICKER_APPS = [
    { id: 'notes', name: 'Notes' },
    { id: 'tasks', name: 'Tasks', auth: { mode: 'public' } },
  ];

  async function seedPickerPending(scope: any, providerIds: string[]): Promise<string> {
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
    return pending.id;
  }

  function pickerScope(configuredProviderIds: string[]) {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true } } as any,
      apps: PICKER_APPS,
    });
    const federatedSessionStore = new InMemoryFederatedAuthSessionStore();
    Object.assign(scope.auth, {
      federatedSessionStore,
      getProviderConfig: (id: string) => (configuredProviderIds.includes(id) ? { id } : undefined),
      buildProviderAuthorizeUrl: async (id: string) => `https://${id}.example.com/authorize`,
    });
    return { scope, federatedSessionStore };
  }

  function pick(scope: any, pendingAuthId: string, providers: string[]) {
    return makeCallback(scope, pendingAuthId, { federated: 'true', providers } as any);
  }

  it('grants the apps it signed in for when it mints at once, leaving out a skipped app provider', async () => {
    const { scope } = pickerScope([]);
    const minted = captureMint(scope);
    const pendingAuthId = await seedPickerPending(scope, ['__parent__', 'tasks']);

    await runFlowStages(pick(scope, pendingAuthId, ['__parent__']), MINT_STAGES);

    expect(minted.params.authorizedAppIds).toEqual(['notes']);
  });

  it('grants every app when the picker links each app provider', async () => {
    const { scope } = pickerScope([]);
    const minted = captureMint(scope);
    const pendingAuthId = await seedPickerPending(scope, ['__parent__', 'tasks']);

    await runFlowStages(pick(scope, pendingAuthId, ['__parent__', 'tasks']), MINT_STAGES);

    expect(new Set(minted.params.authorizedAppIds)).toEqual(new Set(['notes', 'tasks']));
  });

  it('carries the grant in the federated session the provider callback mints from', async () => {
    const { scope, federatedSessionStore } = pickerScope(['github']);
    const store = jest.spyOn(federatedSessionStore, 'store');
    const pendingAuthId = await seedPickerPending(scope, ['github', 'tasks']);

    const { output } = await runFlowStages(pick(scope, pendingAuthId, ['github']), MINT_STAGES);

    expect(output?.kind).toBe('redirect');
    expect(store.mock.calls[0]?.[0].authorizedAppIds).toEqual(['notes']);
  });
});

describe('OAuth Callback Flow — tool consent on an incremental authorization', () => {
  const TOOL_IDS = ['notes:create', 'notes:list', 'tasks:add'];

  function consentScope() {
    return createMockScopeEntry({
      auth: { mode: 'local', incrementalAuth: { enabled: true }, consent: { enabled: true } } as any,
      apps: APPS,
      tools: TOOL_IDS.map((id) => ({ id, name: id })),
    });
  }

  it.each([
    ['a local sign-in', undefined],
    ['a sign-in through the provider picker', ['__parent__', 'tasks']],
  ])('keeps the tools the user chose on %s, instead of every offered tool', async (_label, federatedProviderIds) => {
    const scope = consentScope();
    await (scope.auth as any).consentStore.set({
      userSub: 'user-1',
      clientId: 'local-client',
      selectedToolIds: ['notes:create'],
      seenToolIds: TOOL_IDS,
      updatedAt: Date.now(),
    });
    const pendingAuthId = await seedIncrementalPending(scope, {
      targetAppId: 'tasks',
      priorAuthorizedAppIds: ['notes'],
      federatedProviderIds,
      consentToolIds: TOOL_IDS,
    });

    const { state } = await runFlowStages(makeCallback(scope, pendingAuthId), ['parseInput', 'validatePendingAuth']);

    expect(state.selectedTools).toEqual(['notes:create']);
  });

  it('asks which tools to enable when no earlier choice is remembered', async () => {
    const scope = consentScope();
    const pendingAuthId = await seedIncrementalPending(scope, { targetAppId: 'tasks', consentToolIds: TOOL_IDS });

    const { output, state } = await runFlowStages(makeCallback(scope, pendingAuthId), [
      'parseInput',
      'validatePendingAuth',
    ]);

    expect(output?.kind).toBe('html');
    expect(String(output?.body)).toContain('Select Tools to Enable');
    expect(state.selectedTools).toBeUndefined();
  });
});
