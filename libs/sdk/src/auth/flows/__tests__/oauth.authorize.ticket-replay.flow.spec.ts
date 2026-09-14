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

import { signIncrementalAuthTicket } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import {
  createOAuthInput,
  createValidOAuthRequest,
  flowScenarios,
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

describe('OAuth Authorize Flow — replayed incremental ticket', () => {
  async function authorizeWith(scope: ReturnType<typeof flowScenarios.incrementalAuth>, ticket: string) {
    const params = { ...createValidOAuthRequest(), mode: 'incremental', app: 'slack', ticket };
    const flow = new OauthAuthorizeFlow(authorizeMetadata(), createOAuthInput(params), scope, jest.fn(), new Map());
    await runFlowStages(flow, [...STAGES]);
    const pendingId = flow.state.snapshot()['pendingAuthId'] as string;
    return scope.auth.authorizationStore.getPendingAuthorization(pendingId);
  }

  it('drops the ticket-supplied prior grants, not just the target app', async () => {
    const scope = flowScenarios.incrementalAuth('slack');
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
