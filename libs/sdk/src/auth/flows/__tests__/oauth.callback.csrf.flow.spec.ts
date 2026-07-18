/**
 * OAuth Callback — built-in login CSRF (same-origin) defense (security regression).
 *
 * The built-in login/consent pages are served by THIS server and submit back to
 * `/oauth/callback`, so a legitimate submission is always same-origin. A
 * cross-site login-CSRF/fixation carries the attacker page's `Origin`/`Referer`
 * (set by the browser, unforgeable by script). The callback must reject a
 * state-changing submission whose present `Origin`/`Referer` names a different
 * host, while remaining non-breaking when neither header is present.
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

async function seedPendingAuth(scope: ReturnType<typeof createMockScopeEntry>): Promise<string> {
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

async function runCallback(headers: Record<string, string>) {
  const scope = createMockScopeEntry({ auth: { mode: 'local' } as never });
  const pendingAuthId = await seedPendingAuth(scope);
  const input = createMockHttpRequest({
    method: 'GET',
    path: '/oauth/callback',
    query: { pending_auth_id: pendingAuthId, email: 'user@example.com' },
    headers,
  });
  const flow = new OauthCallbackFlow(createCallbackMetadata(), input as never, scope, jest.fn(), new Map());
  return runFlowStages(flow, ['parseInput', 'validatePendingAuth']);
}

describe('OAuth Callback Flow — built-in login CSRF (same-origin) defense', () => {
  it('rejects a cross-origin submission (Origin host ≠ request host)', async () => {
    const { output } = await runCallback({ origin: 'https://evil.example', host: 'mcp.example.com' });

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
    expect(String(output?.body)).toContain('Cross-origin request blocked');
  });

  it('rejects a cross-origin submission detected via Referer', async () => {
    const { output } = await runCallback({
      referer: 'https://evil.example/attack',
      host: 'mcp.example.com',
    });

    expect(output?.kind).toBe('html');
    expect(output?.status).toBe(400);
  });

  it('allows a same-origin submission (Origin host === request host)', async () => {
    const { output, state } = await runCallback({
      origin: 'https://mcp.example.com',
      host: 'mcp.example.com',
    });

    // validatePendingAuth completes (no block) and derives a userSub.
    expect(output).toBeUndefined();
    expect(typeof state.userSub).toBe('string');
  });

  it('allows a same-origin submission matched against X-Forwarded-Host (proxy)', async () => {
    const { output } = await runCallback({
      origin: 'https://mcp.example.com',
      host: 'internal-host:3001',
      'x-forwarded-host': 'mcp.example.com',
    });

    expect(output).toBeUndefined();
  });

  it('does NOT block when neither Origin nor Referer is present (non-breaking)', async () => {
    const { output, state } = await runCallback({ host: 'mcp.example.com' });

    expect(output).toBeUndefined();
    expect(typeof state.userSub).toBe('string');
  });
});
