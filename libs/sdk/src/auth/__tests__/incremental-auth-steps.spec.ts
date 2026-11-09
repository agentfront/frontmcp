/**
 * `incrementalAuth.showAllAppsAtOnce: false`: the provider picker asks one provider per page, driven over the
 * fetch handler the way a browser walks it. Each step is answered on the pending authorization with its CSRF
 * token, `allowSkip` and `federatedAuth.requiredProviders` are checked at every step, and the last step finishes
 * the sign-in as the one-page picker does.
 */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  decodeJwtPayload,
  disposeServers,
  exchangeCode,
  httpGet,
  inputValue,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

@Tool({ name: 'list_notes', inputSchema: {} })
class ListNotesTool extends ToolContext {
  async execute() {
    return { notes: [] };
  }
}

@Tool({ name: 'list_tasks', inputSchema: {} })
class ListTasksTool extends ToolContext {
  async execute() {
    return { tasks: [] };
  }
}

@Tool({ name: 'list_deals', inputSchema: {} })
class ListDealsTool extends ToolContext {
  async execute() {
    return { deals: [] };
  }
}

@App({ id: 'notes', name: 'Notes', tools: [ListNotesTool] })
class NotesApp {}

@App({ id: 'tasks', name: 'Tasks', auth: { mode: 'public' }, tools: [ListTasksTool] })
class TasksApp {}

@App({ id: 'crm', name: 'Crm', auth: { mode: 'public' }, tools: [ListDealsTool] })
class CrmApp {}

const HOST = 'desk.example.com';
const CLIENT_ID = 'desk-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const servers: TestFetchServer[] = [];
let dir: string;
let customPage: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'federated-steps-'));
  customPage = join(dir, 'federated.tsx');
  await writeFile(
    customPage,
    "import React from 'react';\nexport default () => React.createElement('p', null, 'steps');\n",
  );
});

afterAll(async () => {
  await disposeServers(servers);
  await rm(dir, { recursive: true, force: true });
});

async function serverWith(auth: Record<string, unknown> = {}): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'federated-steps', version: '1.0.0' },
    apps: [NotesApp, TasksApp, CrmApp],
    auth: {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
      incrementalAuth: { enabled: true, showAllAppsAtOnce: false },
      ...auth,
    } as AuthConfig,
  });
  servers.push(server);
  return server;
}

interface StepPage {
  status: number;
  html: string;
  pendingAuthId: string;
  csrf: string;
}

async function stepPage(response: Response): Promise<StepPage> {
  const html = await response.text();
  return {
    status: response.status,
    html,
    pendingAuthId: inputValue(html, 'pending_auth_id') ?? '',
    csrf: inputValue(html, 'csrf') ?? '',
  };
}

async function firstStep(server: TestFetchServer): Promise<StepPage> {
  return stepPage(
    await httpGet(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state: 's1' }),
      HOST,
    ),
  );
}

function answer(
  server: TestFetchServer,
  page: StepPage,
  step: number,
  action: string,
  extra: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return postForm(
    server.handler,
    '/oauth/callback',
    {
      pending_auth_id: page.pendingAuthId,
      federated: 'true',
      csrf: page.csrf,
      federated_step: String(step),
      action,
      ...extra,
    },
    HOST,
    headers,
  );
}

async function grantedApps(server: TestFetchServer, finish: Response): Promise<unknown> {
  expect(finish.status).toBe(302);
  const code = redirectParams(finish).get('code') ?? '';
  const tokens = await exchangeCode(server.handler, { code, clientId: CLIENT_ID, redirectUri: REDIRECT_URI }, HOST);
  expect(tokens.status).toBe(200);
  return decodeJwtPayload(String(tokens.body['access_token']))['authorized_apps'];
}

describe('incrementalAuth.showAllAppsAtOnce: false', () => {
  it('asks one provider per page, and the last step finishes the sign-in', async () => {
    const server = await serverWith();
    const first = await firstStep(server);

    expect(first.status).toBe(200);
    expect(first.html).toContain('Step 1 of 3');
    expect(first.html).toContain('name="federated_step" value="0"');
    expect(first.html).not.toContain('name="email"');
    expect(first.html).not.toContain('value="back"');
    expect(first.csrf).not.toBe('');

    const second = await stepPage(await answer(server, first, 0, 'continue'));
    expect(second.html).toContain('Step 2 of 3');
    expect(second.html).toContain('Authorize tasks');
    expect(second.html).toContain('value="back"');

    const third = await stepPage(await answer(server, first, 1, 'continue'));
    expect(third.html).toContain('Step 3 of 3');
    expect(third.html).toContain('name="email"');

    const finish = await answer(server, first, 2, 'continue', { email: 'nour@example.com' });

    await expect(grantedApps(server, finish)).resolves.toEqual(['notes', 'tasks', 'crm']);
  });

  it('leaves a skipped provider for later, and Back changes an answer', async () => {
    const server = await serverWith();
    const first = await firstStep(server);
    await answer(server, first, 0, 'continue');
    await answer(server, first, 1, 'skip');

    const back = await stepPage(await answer(server, first, 2, 'back'));
    expect(back.html).toContain('Step 2 of 3');
    await answer(server, first, 1, 'continue');
    const finish = await answer(server, first, 2, 'skip', { email: 'nour@example.com' });

    await expect(grantedApps(server, finish)).resolves.toEqual(['notes', 'tasks']);
  });

  it('shows the current step again for an answer to another step', async () => {
    const server = await serverWith();
    const first = await firstStep(server);
    await answer(server, first, 0, 'continue');

    const stale = await stepPage(await answer(server, first, 0, 'skip'));

    expect(stale.status).toBe(200);
    expect(stale.html).toContain('Step 2 of 3');
  });

  it.each<[string, (page: StepPage) => Record<string, string>]>([
    ['no CSRF token', () => ({ csrf: '' })],
    ['a wrong CSRF token', () => ({ csrf: 'forged' })],
  ])('refuses a step with %s', async (_label, override) => {
    const server = await serverWith();
    const first = await firstStep(server);

    const refused = await answer(server, { ...first, ...override(first) }, 0, 'continue');

    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Invalid or missing CSRF token');
  });

  it('refuses a step submitted from another origin', async () => {
    const server = await serverWith();
    const first = await firstStep(server);

    const refused = await answer(server, first, 0, 'continue', {}, { origin: 'https://attacker.example.net' });

    expect(refused.status).toBe(400);
  });

  it('refuses a one-page picker submission on a step-by-step sign-in', async () => {
    const server = await serverWith();
    const first = await firstStep(server);

    const refused = await postForm(
      server.handler,
      '/oauth/callback',
      { pending_auth_id: first.pendingAuthId, csrf: first.csrf, providers: '__parent__', email: 'nour@example.com' },
      HOST,
    );

    expect(refused.status).toBe(400);
    expect(refused.headers.get('location')).toBeNull();
  });

  it("refuses to skip an app's provider under allowSkip: false, and offers no Skip for it", async () => {
    const server = await serverWith({ incrementalAuth: { enabled: true, showAllAppsAtOnce: false, allowSkip: false } });
    const first = await firstStep(server);
    const second = await stepPage(await answer(server, first, 0, 'continue'));
    expect(second.html).not.toContain('value="skip"');

    const refused = await answer(server, first, 1, 'skip');

    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Required provider(s) not linked: tasks');
  });

  it('refuses to skip a provider in federatedAuth.requiredProviders', async () => {
    const server = await serverWith({ federatedAuth: { requiredProviders: ['crm'] } });
    const first = await firstStep(server);
    await answer(server, first, 0, 'continue');
    await answer(server, first, 1, 'continue');

    const refused = await answer(server, first, 2, 'skip', { email: 'nour@example.com' });

    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Required provider(s) not linked: crm');
  });

  it('shows the last step again with the message when authenticate() refuses the sign-in', async () => {
    const server = await serverWith({ authenticate: async () => ({ ok: false, message: 'Unknown account' }) });
    const first = await firstStep(server);
    await answer(server, first, 0, 'continue');
    await answer(server, first, 1, 'continue');

    const retry = await stepPage(await answer(server, first, 2, 'continue', { email: 'nour@example.com' }));

    expect(retry.status).toBe(200);
    expect(retry.html).toContain('Step 3 of 3');
    expect(retry.html).toContain('Unknown account');
  });

  it('gives a custom federated page the step in extras.step', async () => {
    const server = await serverWith({ ui: { federated: customPage } });
    const response = await httpGet(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state: 's1' }),
      HOST,
    );
    const html = await response.text();
    const state = JSON.parse(/window\["__FRONTMCP_AUTH__"\] = (.*);<\/script>/.exec(html)?.[1] ?? '{}') as {
      pendingAuthId: string;
      csrfToken: string;
      extras: Record<string, unknown>;
    };

    expect(state.extras).toEqual({
      federated: true,
      step: { index: 0, count: 3, providerId: '__parent__', last: false, canGoBack: false, canSkip: true },
    });

    const next = await postForm(
      server.handler,
      '/oauth/callback',
      {
        pending_auth_id: state.pendingAuthId,
        federated: 'true',
        csrf: state.csrfToken,
        federated_step: '0',
        action: 'continue',
      },
      HOST,
    );
    const nextState = JSON.parse(
      /window\["__FRONTMCP_AUTH__"\] = (.*);<\/script>/.exec(await next.text())?.[1] ?? '{}',
    ) as {
      extras: { step: { index: number; providerId: string; decision?: string } };
    };
    expect(nextState.extras.step).toMatchObject({ index: 1, providerId: 'tasks' });
  });
});

describe('incrementalAuth.showAllAppsAtOnce: false with auth.providers', () => {
  it('sends the last step to the first provider it linked', async () => {
    const provider = (id: string) => ({
      id,
      authorizeUrl: `https://${id}.example.com/authorize`,
      tokenUrl: `https://${id}.example.com/token`,
      clientId: `${id}-client`,
    });
    const server = await createTestFetchServer({
      info: { name: 'federated-steps-providers', version: '1.0.0' },
      apps: [NotesApp],
      auth: {
        mode: 'local',
        dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
        providers: [provider('github'), provider('slack')],
        incrementalAuth: { enabled: true, showAllAppsAtOnce: false },
      } as AuthConfig,
    });
    servers.push(server);
    const first = await firstStep(server);
    expect(first.html).toContain('Authorize github');

    await answer(server, first, 0, 'skip');
    const toProvider = await answer(server, first, 1, 'continue', { email: 'nour@example.com' });

    expect(toProvider.status).toBe(302);
    expect(toProvider.headers.get('location')).toMatch(/^https:\/\/slack\.example\.com\/authorize\?/);
  });
});

describe('incrementalAuth.showAllAppsAtOnce: true (the default)', () => {
  it('shows every provider on one picker page, as before', async () => {
    const server = await serverWith({ incrementalAuth: { enabled: true } });
    const page = await httpGet(
      server.handler,
      authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state: 's1' }),
      HOST,
    );
    const html = await page.text();

    expect(html).toContain('Select Authorization Providers');
    expect(html).toContain('value="tasks"');
    expect(html).toContain('value="crm"');
    expect(html).not.toContain('federated_step');
  });
});
