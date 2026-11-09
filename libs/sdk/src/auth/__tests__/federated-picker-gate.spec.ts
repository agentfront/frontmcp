/**
 * A sign-in the provider picker started is held to the picker's rules (`federatedAuth.minProviders`,
 * `federatedAuth.requiredProviders`, `incrementalAuth.allowSkip: false`) by every submission that completes it,
 * whether or not the submission says `federated=true`. Driven over the fetch handler, on both picker paths: the
 * top-level `auth.providers`, and apps with their own `auth`.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  disposeServers,
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

@App({ id: 'notes', name: 'Notes', tools: [ListNotesTool] })
class NotesApp {}

@App({ id: 'tasks', name: 'Tasks', auth: { mode: 'public' }, tools: [ListTasksTool] })
class TasksApp {}

const HOST = 'desk.example.com';
const CLIENT_ID = 'desk-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';

type AuthConfig = NonNullable<FrontMcpConfigInput['auth']>;

const servers: TestFetchServer[] = [];

afterAll(async () => {
  await disposeServers(servers);
});

function upstream(id: string) {
  return {
    id,
    authorizeUrl: `https://${id}.example.com/authorize`,
    tokenUrl: `https://${id}.example.com/token`,
    clientId: `${id}-client`,
  };
}

async function serverWith(auth: Record<string, unknown>, apps = [NotesApp]): Promise<TestFetchServer> {
  const server = await createTestFetchServer({
    info: { name: 'picker-gate', version: '1.0.0' },
    apps,
    auth: {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
      ...auth,
    } as AuthConfig,
  });
  servers.push(server);
  return server;
}

/** The pending authorization id on the page `/oauth/authorize` served. */
async function startSignIn(server: TestFetchServer): Promise<{ pendingAuthId: string; html: string }> {
  const page = await httpGet(
    server.handler,
    authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state: 's1' }),
    HOST,
  );
  expect(page.status).toBe(200);
  const html = await page.text();
  return { pendingAuthId: inputValue(html, 'pending_auth_id') ?? '', html };
}

function submit(server: TestFetchServer, form: Record<string, string | string[]>): Promise<Response> {
  return postForm(server.handler, '/oauth/callback', form, HOST);
}

const providersPicker = (federatedAuth: Record<string, unknown> = {}) =>
  serverWith({ providers: [upstream('github'), upstream('slack')], federatedAuth });

describe('the auth.providers picker', () => {
  it.each<[string, () => Promise<TestFetchServer>, Record<string, string>, string]>([
    ['without a provider, under the default minProviders', () => providersPicker(), {}, 'At least 1 provider'],
    [
      'with too few providers for minProviders',
      () => providersPicker({ minProviders: 2 }),
      { providers: 'github' },
      'At least 2 providers',
    ],
    [
      'without a provider in requiredProviders',
      () => providersPicker({ requiredProviders: ['github'] }),
      { providers: 'slack' },
      'Required provider(s) not linked: github',
    ],
  ])('refuses a submission without federated=true %s', async (_label, start, extra, message) => {
    const server = await start();
    const { pendingAuthId } = await startSignIn(server);

    const refused = await submit(server, { pending_auth_id: pendingAuthId, email: 'nour@example.com', ...extra });

    expect(refused.status).toBe(400);
    expect(refused.headers.get('location')).toBeNull();
    expect(await refused.text()).toContain(message);
  });

  it.each<[string, Record<string, string>]>([
    ['the picker form', { federated: 'true' }],
    ['a submission without federated=true', {}],
  ])('starts the sign-in at the first chosen provider for %s', async (_label, extra) => {
    const server = await providersPicker({ requiredProviders: ['github'] });
    const { pendingAuthId } = await startSignIn(server);

    const toProvider = await submit(server, {
      pending_auth_id: pendingAuthId,
      providers: 'github',
      email: 'nour@example.com',
      ...extra,
    });

    expect(toProvider.status).toBe(302);
    expect(toProvider.headers.get('location')).toMatch(/^https:\/\/github\.example\.com\/authorize\?/);
  });

  it('keeps the choice made on the picker for the login page shown again after authenticate() refused it', async () => {
    const server = await serverWith({
      providers: [upstream('github')],
      authenticate: async (input: { fields: Record<string, string> }) =>
        input.fields['email'] === 'nour@example.com' ? { ok: true } : { ok: false, message: 'Unknown account' },
    });
    const { pendingAuthId } = await startSignIn(server);
    const retryPage = await submit(server, {
      pending_auth_id: pendingAuthId,
      federated: 'true',
      providers: 'github',
      email: 'someone@example.com',
    });
    expect(retryPage.status).toBe(200);
    expect(await retryPage.text()).toContain('Unknown account');

    const toProvider = await submit(server, { pending_auth_id: pendingAuthId, email: 'nour@example.com' });

    expect(toProvider.status).toBe(302);
    expect(toProvider.headers.get('location')).toMatch(/^https:\/\/github\.example\.com\/authorize\?/);
  });
});

describe('the picker of apps with their own auth', () => {
  it('refuses a submission without federated=true and without a provider', async () => {
    const server = await serverWith({}, [NotesApp, TasksApp]);
    const { pendingAuthId } = await startSignIn(server);

    const refused = await submit(server, { pending_auth_id: pendingAuthId, email: 'nour@example.com' });

    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('At least 1 provider');
  });

  it("refuses a submission without federated=true that leaves an app's provider out under allowSkip: false", async () => {
    const server = await serverWith({ incrementalAuth: { enabled: true, allowSkip: false } }, [NotesApp, TasksApp]);
    const { pendingAuthId } = await startSignIn(server);

    const refused = await submit(server, {
      pending_auth_id: pendingAuthId,
      providers: '__parent__',
      email: 'nour@example.com',
    });

    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Required provider(s) not linked: tasks');
  });

  it('issues the code for the picker form', async () => {
    const server = await serverWith({ incrementalAuth: { enabled: true, allowSkip: false } }, [NotesApp, TasksApp]);
    const { pendingAuthId } = await startSignIn(server);

    const finish = await submit(server, {
      pending_auth_id: pendingAuthId,
      federated: 'true',
      providers: ['__parent__', 'tasks'],
      email: 'nour@example.com',
    });

    expect(finish.status).toBe(302);
    expect(redirectParams(finish).get('code')).toEqual(expect.any(String));
  });
});

describe('a sign-in without the picker', () => {
  it('still issues the code for the email form', async () => {
    const server = await serverWith({});
    const { pendingAuthId, html } = await startSignIn(server);
    expect(html).not.toContain('name="providers"');

    const finish = await submit(server, { pending_auth_id: pendingAuthId, email: 'nour@example.com' });

    expect(finish.status).toBe(302);
    expect(redirectParams(finish).get('code')).toEqual(expect.any(String));
  });
});
