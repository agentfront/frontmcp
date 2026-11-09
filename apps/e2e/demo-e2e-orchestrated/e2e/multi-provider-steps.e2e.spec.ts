/**
 * E2E: `incrementalAuth.showAllAppsAtOnce: false` on the multi-provider server. The sign-in asks about GitHub,
 * then Slack, one page each; Slack is skipped, the last step carries the email, and the sign-in goes on to GitHub
 * as the one-page picker's would.
 */
import { expect, MockOAuthServer, test, TestTokenFactory } from '@frontmcp/testing';

import { browserFetch } from './browser-fetch';

let githubServer: MockOAuthServer;
let slackServer: MockOAuthServer;

beforeAll(async () => {
  githubServer = new MockOAuthServer(new TestTokenFactory({ issuer: 'https://github.mock.local' }), {
    autoApprove: true,
    testUser: { sub: 'github-user-123', email: 'user@github.example.com', name: 'GitHub Test User' },
    clientId: 'github-client',
    validRedirectUris: ['http://localhost:*/oauth/provider/github/callback'],
  });
  slackServer = new MockOAuthServer(new TestTokenFactory({ issuer: 'https://slack.mock.local' }), {
    autoApprove: true,
    testUser: { sub: 'slack-user-456', email: 'user@slack.example.com', name: 'Slack Test User' },
    clientId: 'slack-client',
    validRedirectUris: ['http://localhost:*/oauth/provider/slack/callback'],
  });
  await Promise.all([githubServer.start(), slackServer.start()]);
  process.env['GITHUB_ISSUER'] = githubServer.info.issuer;
  process.env['GITHUB_CLIENT_ID'] = 'github-client';
  process.env['SLACK_ISSUER'] = slackServer.info.issuer;
  process.env['SLACK_CLIENT_ID'] = 'slack-client';
});

afterAll(async () => {
  delete process.env['GITHUB_ISSUER'];
  delete process.env['GITHUB_CLIENT_ID'];
  delete process.env['SLACK_ISSUER'];
  delete process.env['SLACK_CLIENT_ID'];
  await Promise.all([githubServer?.stop(), slackServer?.stop()]);
});

test.describe('Step-by-step provider picker E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-orchestrated/src/main-multi-provider.ts',
    project: 'demo-e2e-orchestrated',
    env: { JWT_SECRET: 'orchestrated-e2e-shared-secret-0123456789', PROVIDER_STEPS: '1' },
  });

  function field(html: string, name: string): string {
    return html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1] ?? '';
  }

  test('asks about each provider on its own page and goes on to the one linked', async ({ server }) => {
    const { generatePkcePair } = await import('@frontmcp/utils');
    const { codeChallenge } = await generatePkcePair();
    const authorizeUrl = new URL(`${server.info.baseUrl}/oauth/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: 'e2e-client',
      redirect_uri: 'http://127.0.0.1:65000/callback',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'openid',
      state: 'e2e-state',
    }).toString();

    const first = await browserFetch(authorizeUrl.toString(), { redirect: 'manual' });
    const firstHtml = await first.text();
    expect(first.status).toBe(200);
    expect(firstHtml).toContain('Step 1 of 2');
    expect(firstHtml).toContain('Authorize github');
    const pendingAuthId = field(firstHtml, 'pending_auth_id');
    const csrf = field(firstHtml, 'csrf');

    const answer = (step: string, action: string, extra: Record<string, string> = {}) =>
      browserFetch(`${server.info.baseUrl}/oauth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          pending_auth_id: pendingAuthId,
          federated: 'true',
          csrf,
          federated_step: step,
          action,
          ...extra,
        }).toString(),
        redirect: 'manual',
      });

    const second = await answer('0', 'continue');
    const secondHtml = await second.text();
    expect(second.status).toBe(200);
    expect(secondHtml).toContain('Step 2 of 2');
    expect(secondHtml).toContain('Authorize slack');
    expect(secondHtml).toContain('name="email"');

    const toProvider = await answer('1', 'skip', { email: 'user@example.com' });

    expect(toProvider.status).toBe(302);
    expect(toProvider.headers.get('location')).toContain(githubServer.info.issuer);
  });
});
