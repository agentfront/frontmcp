/**
 * OAuth Authorize Flow — what a replayed incremental ticket downgrades to.
 *
 * An incremental ticket is single-use (GHSA-2c4g-9c8x-6m8g). A second
 * presentation is not an error: the request falls back to an ordinary login.
 * That downgrade has to drop EVERY value the ticket supplied — including the
 * prior grant list. Keeping it narrows the new session to the apps the caller
 * already had while `targetAppId` is gone, so the tool call that started the
 * flow still is not authorized and immediately starts it again.
 */
import 'reflect-metadata';

import { openPendingLogin, signIncrementalAuthTicket } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import {
  createMockScopeEntry,
  createOAuthInput,
  createValidOAuthRequest,
  MOCK_SIGNING_SECRET,
  runFlowStages,
} from '../../../__test-utils__';
import {
  HttpHtmlSchema,
  httpInputSchema,
  HttpRedirectSchema,
  HttpTextSchema,
  type FlowMetadata,
} from '../../../common';
import { incrementalTicketAudience } from '../../authorized-apps.utils';
import type { LocalPrimaryAuth } from '../../instances/instance.local-primary-auth';
import OauthAuthorizeFlow from '../oauth.authorize.flow';

function authorizeMetadata(): FlowMetadata<'oauth:authorize'> {
  return {
    name: 'oauth:authorize',
    plan: {
      pre: ['parseInput', 'validateInput', 'checkIfAuthorized'],
      execute: ['prepareAuthorizationRequest', 'buildAuthorizeOutput'],
      post: ['validateOutput'],
    },
    inputSchema: httpInputSchema,
    outputSchema: z.union([HttpRedirectSchema, HttpTextSchema, HttpHtmlSchema]),
    access: 'public',
    middleware: { method: 'GET', path: '/oauth/authorize' },
  } as FlowMetadata<'oauth:authorize'>;
}

const STAGES = ['parseInput', 'validateInput', 'checkIfAuthorized', 'prepareAuthorizationRequest'] as const;

/** A local-mode scope with a Slack app, which it authorizes incrementally when `incrementalAuth` is enabled. */
function slackScope(incrementalAuthEnabled = true) {
  return createMockScopeEntry({
    auth: { mode: 'local', ...(incrementalAuthEnabled ? { incrementalAuth: { enabled: true } } : {}) } as never,
    apps: [{ id: 'slack', name: 'Slack' }],
  });
}

describe('OAuth Authorize Flow — replayed incremental ticket', () => {
  async function authorizeWith(scope: ReturnType<typeof slackScope>, ticket: string) {
    const params = { ...createValidOAuthRequest(), mode: 'incremental', app: 'slack', ticket };
    const flow = new OauthAuthorizeFlow(authorizeMetadata(), createOAuthInput(params), scope, jest.fn(), new Map());
    await runFlowStages(flow, [...STAGES]);
    const pendingId = flow.state.snapshot()['pendingAuthId'] as string;
    return (scope.auth as LocalPrimaryAuth).authorizationStore.getPendingAuthorization(pendingId);
  }

  it('drops the ticket-supplied prior grants, not just the target app', async () => {
    const scope = slackScope();
    const ticket = signIncrementalAuthTicket(
      { sub: 'user-1', appId: 'slack', priorAppIds: ['github'] },
      MOCK_SIGNING_SECRET,
    );

    const first = await authorizeWith(scope, ticket);
    expect(first?.isIncremental).toBe(true);
    expect(first?.priorAuthorizedAppIds).toEqual(['github']);

    // Same ticket, second time — the claim fails and the request downgrades.
    const replayed = await authorizeWith(scope, ticket);

    expect(replayed?.isIncremental).toBe(false);
    expect(replayed?.targetAppId).toBeUndefined();
    // An ordinary login grants the whole scope; a leftover list would narrow it
    // to exactly the apps that already failed to cover the caller's tool.
    expect(replayed?.priorAuthorizedAppIds).toBeUndefined();
  });
});

describe('OAuth Authorize Flow — the profile an incremental ticket carries', () => {
  it("keeps the subject's email and name, sealed, on the pending authorization", async () => {
    const scope = slackScope();
    const ticket = signIncrementalAuthTicket(
      { sub: 'user-1', appId: 'slack', email: 'ada@example.com', name: 'Ada Lovelace' },
      MOCK_SIGNING_SECRET,
    );
    const params = { ...createValidOAuthRequest(), mode: 'incremental', app: 'slack', ticket };
    const flow = new OauthAuthorizeFlow(authorizeMetadata(), createOAuthInput(params), scope, jest.fn(), new Map());
    await runFlowStages(flow, [...STAGES]);
    const localAuth = scope.auth as LocalPrimaryAuth;
    const pending = await localAuth.authorizationStore.getPendingAuthorization(
      flow.state.snapshot()['pendingAuthId'] as string,
    );
    if (!pending?.verifiedLogin) throw new Error('expected the ticket profile on the pending authorization');

    expect(pending.verifiedLogin).not.toContain('ada@example.com');
    expect(openPendingLogin(localAuth.secret, pending.id, pending.verifiedLogin)).toEqual({
      sub: 'user-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });
  });
});

describe('OAuth Authorize Flow — a ticket this endpoint does not authorize', () => {
  async function pendingFor(scope: ReturnType<typeof slackScope>, ticket: string) {
    const params = { ...createValidOAuthRequest(), mode: 'incremental', app: 'slack', ticket };
    const flow = new OauthAuthorizeFlow(authorizeMetadata(), createOAuthInput(params), scope, jest.fn(), new Map());
    await runFlowStages(flow, [...STAGES]);
    return (scope.auth as LocalPrimaryAuth).authorizationStore.getPendingAuthorization(
      flow.state.snapshot()['pendingAuthId'] as string,
    );
  }

  it('runs an ordinary login where incremental authorization is not enabled', async () => {
    const ticket = signIncrementalAuthTicket({ sub: 'user-1', appId: 'slack' }, MOCK_SIGNING_SECRET);

    const pending = await pendingFor(slackScope(false), ticket);

    expect(pending?.isIncremental).toBe(false);
    expect(pending?.incrementalSub).toBeUndefined();
  });

  it('runs an ordinary login for a ticket naming an app this endpoint does not serve', async () => {
    const ticket = signIncrementalAuthTicket({ sub: 'user-1', appId: 'billing' }, MOCK_SIGNING_SECRET);

    const pending = await pendingFor(slackScope(), ticket);

    expect(pending?.isIncremental).toBe(false);
    expect(pending?.incrementalSub).toBeUndefined();
  });

  it('runs an ordinary login for a ticket minted for another endpoint', async () => {
    const ticket = signIncrementalAuthTicket(
      { sub: 'user-1', appId: 'slack', audience: JSON.stringify(['https://other.example.com', '/other']) },
      MOCK_SIGNING_SECRET,
    );

    const pending = await pendingFor(slackScope(), ticket);

    expect(pending?.isIncremental).toBe(false);
  });

  it('expands the grant for a ticket minted for this endpoint', async () => {
    const scope = slackScope();
    const ticket = signIncrementalAuthTicket(
      { sub: 'user-1', appId: 'slack', audience: incrementalTicketAudience(scope) },
      MOCK_SIGNING_SECRET,
    );

    const pending = await pendingFor(scope, ticket);

    expect(pending?.isIncremental).toBe(true);
    expect(pending?.incrementalSub).toBe('user-1');
  });
});
