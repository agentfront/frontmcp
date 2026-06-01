/**
 * OAuth Callback Flow — consent gate (per-client tool selection).
 *
 * Verifies the non-federated consent flow at /oauth/callback:
 * - consent enabled + no submission → render the consent screen (200 HTML),
 *   WITHOUT deleting the pending authorization (it round-trips),
 * - a submitted selection proceeds to mint with the chosen tools,
 * - `requireSelection` rejects an empty submit by re-rendering with an error,
 * - `excludedTools` are never offered but are always included in the consented
 *   set (always available),
 * - an out-of-range tool id is rejected with a 400,
 * - consent disabled is unchanged (mints with all available tools).
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

/** Seed a pending authorization whose consent state offers `availableToolIds`. */
async function seedConsentPendingAuth(scope: any, availableToolIds: string[]): Promise<string> {
  const store = scope.auth.authorizationStore;
  const pkce = generatePkceChallenge('a'.repeat(64));
  const pending = store.createPendingRecord({
    clientId: 'local-client',
    redirectUri: 'http://127.0.0.1:54321/callback',
    scopes: ['openid'],
    pkce,
    state: 'xyz',
    consent: {
      enabled: true,
      availableToolIds,
      selectedToolIds: undefined,
      consentCompleted: false,
    },
  });
  await store.storePendingAuthorization(pending);
  return pending.id;
}

function runCallback(scope: any, query: Record<string, string | string[]>) {
  const input = createMockHttpRequest({ method: 'GET', path: '/oauth/callback', query: query as any });
  const flow = new OauthCallbackFlow(createCallbackMetadata(), input as any, scope, jest.fn(), new Map());
  return runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
}

const TOOLS = [
  { id: 'notes:create', name: 'Create Note', description: 'Create a note' },
  { id: 'notes:list', name: 'List Notes', description: 'List notes' },
];

describe('OAuth Callback Flow — consent gate', () => {
  it('renders the consent screen (200 HTML) when consent is enabled and no selection was submitted', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false, consent: { enabled: true } } as any,
      apps: [{ id: 'notes', name: 'Notes' }],
      tools: TOOLS,
    });
    const pendingAuthId = await seedConsentPendingAuth(scope, ['notes:create', 'notes:list']);

    const { output } = await runCallback(scope, {
      pending_auth_id: pendingAuthId,
      email: 'user@example.com',
    });

    expect(output?.kind).toBe('html');
    // Consent page is a 200 HTML page (not a 4xx error page).
    expect(output?.status === undefined || output?.status === 200).toBe(true);
    expect(String(output?.body)).toContain('Select Tools to Enable');
    expect(String(output?.body)).toContain('Create Note');
    expect(String(output?.body)).toContain('List Notes');
    // The form round-trips the identity so the resubmit re-derives the sub.
    expect(String(output?.body)).toContain('name="email" value="user@example.com"');

    // CRITICAL: the pending authorization must NOT have been deleted — the
    // consent form posts back to /oauth/callback using the same id.
    const stillPending = await scope.auth.authorizationStore.getPendingAuthorization(pendingAuthId);
    expect(stillPending).toBeTruthy();
  });

  it('proceeds to mint with the submitted selection and deletes the pending authorization', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false, consent: { enabled: true } } as any,
      apps: [{ id: 'notes', name: 'Notes' }],
      tools: TOOLS,
    });
    const pendingAuthId = await seedConsentPendingAuth(scope, ['notes:create', 'notes:list']);

    const { output, state } = await runCallback(scope, {
      pending_auth_id: pendingAuthId,
      email: 'user@example.com',
      consent_submitted: '1',
      tools: ['notes:create'],
    });

    // No error/consent page — the gate passed.
    expect(output).toBeUndefined();
    expect(state.consentEnabled).toBe(true);
    expect(state.selectedTools).toEqual(['notes:create']);

    // The pending authorization is cleaned up now that we are minting.
    const gone = await scope.auth.authorizationStore.getPendingAuthorization(pendingAuthId);
    expect(gone == null).toBe(true);
  });

  it('rejects an empty submit (requireSelection default) by re-rendering with an error', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false, consent: { enabled: true } } as any,
      apps: [{ id: 'notes', name: 'Notes' }],
      tools: TOOLS,
    });
    const pendingAuthId = await seedConsentPendingAuth(scope, ['notes:create', 'notes:list']);

    const { output } = await runCallback(scope, {
      pending_auth_id: pendingAuthId,
      email: 'user@example.com',
      consent_submitted: '1',
      // no tools selected
    });

    expect(output?.kind).toBe('html');
    expect(String(output?.body)).toContain('Select Tools to Enable');
    expect(String(output?.body)).toContain('Please select at least one tool to continue.');

    // Pending auth kept alive for the retry.
    const stillPending = await scope.auth.authorizationStore.getPendingAuthorization(pendingAuthId);
    expect(stillPending).toBeTruthy();
  });

  it('allows an empty submit when requireSelection is false', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false, consent: { enabled: true, requireSelection: false } } as any,
      apps: [{ id: 'notes', name: 'Notes' }],
      tools: TOOLS,
    });
    const pendingAuthId = await seedConsentPendingAuth(scope, ['notes:create', 'notes:list']);

    const { output, state } = await runCallback(scope, {
      pending_auth_id: pendingAuthId,
      email: 'user@example.com',
      consent_submitted: '1',
    });

    expect(output).toBeUndefined();
    expect(state.selectedTools).toEqual([]); // empty allowed → zero tools consented
  });

  it('excludes excludedTools from the offered set but always includes them in the consented set', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false, consent: { enabled: true, excludedTools: ['notes:list'] } } as any,
      apps: [{ id: 'notes', name: 'Notes' }],
      tools: TOOLS,
    });
    // The authorize flow would have stored only the non-excluded tool as available.
    const pendingAuthId = await seedConsentPendingAuth(scope, ['notes:create']);

    // Render: the excluded tool must NOT be offered.
    const { output: page } = await runCallback(scope, {
      pending_auth_id: pendingAuthId,
      email: 'user@example.com',
    });
    expect(String(page?.body)).toContain('Create Note');
    expect(String(page?.body)).not.toContain('List Notes');

    // Submit the offered tool; the excluded tool is always included anyway.
    const pendingAuthId2 = await seedConsentPendingAuth(scope, ['notes:create']);
    const { state } = await runCallback(scope, {
      pending_auth_id: pendingAuthId2,
      email: 'user@example.com',
      consent_submitted: '1',
      tools: ['notes:create'],
    });
    expect(new Set(state.selectedTools)).toEqual(new Set(['notes:create', 'notes:list']));
  });

  it('rejects a submitted tool id that was not offered with a 400', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false, consent: { enabled: true } } as any,
      apps: [{ id: 'notes', name: 'Notes' }],
      tools: TOOLS,
    });
    const pendingAuthId = await seedConsentPendingAuth(scope, ['notes:create', 'notes:list']);

    const { output } = await runCallback(scope, {
      pending_auth_id: pendingAuthId,
      email: 'user@example.com',
      consent_submitted: '1',
      tools: ['notes:create', 'evil:tool'],
    });

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('Invalid tool selection');
  });

  // ===========================================================
  // rememberConsent (per-(user, client) selection reuse)
  // ===========================================================
  describe('rememberConsent', () => {
    it('persists the submitted selection (seenToolIds = full offered set)', async () => {
      const scope = createMockScopeEntry({
        auth: { mode: 'local', requireEmail: false, consent: { enabled: true } } as any,
        apps: [{ id: 'notes', name: 'Notes' }],
        tools: TOOLS,
      });
      const pendingAuthId = await seedConsentPendingAuth(scope, ['notes:create', 'notes:list']);

      const { output, state } = await runCallback(scope, {
        pending_auth_id: pendingAuthId,
        email: 'user@example.com',
        consent_submitted: '1',
        tools: ['notes:create'],
      });
      expect(output).toBeUndefined();

      // The record is keyed by the SAME derived userSub the mint used.
      const record = await (scope as any).auth.consentStore.get(state.userSub, 'local-client');
      expect(record).toBeTruthy();
      expect(record.selectedToolIds).toEqual(['notes:create']);
      expect(record.seenToolIds).toEqual(['notes:create', 'notes:list']);
      expect(typeof record.updatedAt).toBe('number');
    });

    it('SKIPS the consent screen on a revisit and mints the remembered selection (+ excluded)', async () => {
      const scope = createMockScopeEntry({
        auth: { mode: 'local', requireEmail: false, consent: { enabled: true, excludedTools: ['notes:list'] } } as any,
        apps: [{ id: 'notes', name: 'Notes' }],
        tools: TOOLS,
      });

      // First login: submit a selection (persists under the derived userSub).
      const firstId = await seedConsentPendingAuth(scope, ['notes:create']);
      await runCallback(scope, {
        pending_auth_id: firstId,
        email: 'user@example.com',
        consent_submitted: '1',
        tools: ['notes:create'],
      });

      // Second login (FIRST visit — no submission): must SKIP the screen.
      const secondId = await seedConsentPendingAuth(scope, ['notes:create']);
      const { output, state } = await runCallback(scope, {
        pending_auth_id: secondId,
        email: 'user@example.com',
      });

      // No consent page rendered — the gate was skipped and we proceed to mint.
      expect(output).toBeUndefined();
      expect(state.consentEnabled).toBe(true);
      // Minted set = remembered selection ∪ always-available excludedTools.
      expect(new Set(state.selectedTools)).toEqual(new Set(['notes:create', 'notes:list']));
    });

    it('RE-PROMPTS pre-filled with the prior selection when a NEW tool appears', async () => {
      // First server only offers `notes:create`.
      const scope = createMockScopeEntry({
        auth: { mode: 'local', requireEmail: false, consent: { enabled: true } } as any,
        apps: [{ id: 'notes', name: 'Notes' }],
        tools: [TOOLS[0]],
      });
      const firstId = await seedConsentPendingAuth(scope, ['notes:create']);
      await runCallback(scope, {
        pending_auth_id: firstId,
        email: 'user@example.com',
        consent_submitted: '1',
        tools: ['notes:create'],
      });

      // A new tool (`notes:list`) is now available → re-prompt PRE-FILLED.
      const scope2 = createMockScopeEntry({
        auth: { mode: 'local', requireEmail: false, consent: { enabled: true } } as any,
        apps: [{ id: 'notes', name: 'Notes' }],
        tools: TOOLS,
      });
      // Reuse the SAME remembered store so the prior selection is visible.
      (scope2 as any).auth.consentStore = (scope as any).auth.consentStore;

      const secondId = await seedConsentPendingAuth(scope2, ['notes:create', 'notes:list']);
      const { output } = await runCallback(scope2, {
        pending_auth_id: secondId,
        email: 'user@example.com',
      });

      // The consent screen is rendered (NOT skipped) so the user decides on the new tool.
      expect(output?.kind).toBe('html');
      expect(String(output?.body)).toContain('Select Tools to Enable');
      // Prior selection pre-checked; the NEW tool is present but unchecked.
      const body = String(output?.body);
      const createCheckbox = body.match(/value="notes:create"[^>]*/)?.[0] ?? '';
      const listCheckbox = body.match(/value="notes:list"[^>]*/)?.[0] ?? '';
      expect(createCheckbox).toContain('checked');
      expect(listCheckbox).not.toContain('checked');
    });

    it('does NOT skip or persist when rememberConsent is false (default behavior preserved)', async () => {
      const scope = createMockScopeEntry({
        auth: { mode: 'local', requireEmail: false, consent: { enabled: true, rememberConsent: false } } as any,
        apps: [{ id: 'notes', name: 'Notes' }],
        tools: TOOLS,
      });

      // Submit a selection — with rememberConsent off, nothing is persisted.
      const firstId = await seedConsentPendingAuth(scope, ['notes:create', 'notes:list']);
      const { state } = await runCallback(scope, {
        pending_auth_id: firstId,
        email: 'user@example.com',
        consent_submitted: '1',
        tools: ['notes:create'],
      });
      const record = await (scope as any).auth.consentStore.get(state.userSub, 'local-client');
      expect(record).toBeNull();

      // A subsequent first-visit login STILL shows the consent screen.
      const secondId = await seedConsentPendingAuth(scope, ['notes:create', 'notes:list']);
      const { output } = await runCallback(scope, {
        pending_auth_id: secondId,
        email: 'user@example.com',
      });
      expect(output?.kind).toBe('html');
      expect(String(output?.body)).toContain('Select Tools to Enable');
    });
  });

  it('does NOT render consent when consent is disabled (default preserved — mints all available)', async () => {
    const scope = createMockScopeEntry({
      auth: { mode: 'local', requireEmail: false } as any, // no consent config
      apps: [{ id: 'notes', name: 'Notes' }],
      tools: TOOLS,
    });
    // A pending record with no consent state.
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

    const { output, state } = await runCallback(scope, {
      pending_auth_id: pending.id,
      email: 'user@example.com',
    });

    expect(output).toBeUndefined();
    expect(state.consentEnabled).toBe(false);
  });
});
