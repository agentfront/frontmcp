/**
 * People sessions outlive a restart when the server has a store (#1355): a browser signed in before the restart opens
 * the same page after it. Without one, or with `store: false`, a restart still signs everyone out.
 */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, HttpRoute, HttpRouteContext, type FrontMcpConfigInput } from '../../common';
import type { Scope } from '../../scope/scope.instance';

@HttpRoute({ method: 'GET', path: '/board' })
class BoardRoute extends HttpRouteContext {
  handle() {
    return 'the board';
  }
}

@App({ id: 'desk', name: 'Desk', routes: [BoardRoute] })
class DeskApp {}

const ORIGIN = 'http://localhost';
let dir: string;
const running: TestFetchServer[] = [];

beforeAll(async () => {
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  dir = await mkdtemp(join(tmpdir(), 'people-sessions-'));
});

afterAll(async () => {
  await disposeServers(running.splice(0));
  await rm(dir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

async function start(config: Partial<FrontMcpConfigInput>): Promise<TestFetchServer> {
  const server = await createTestFetchServer({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp], ...config });
  running.push(server);
  return server;
}

async function restart(server: TestFetchServer, config: Partial<FrontMcpConfigInput>): Promise<TestFetchServer> {
  running.splice(running.indexOf(server), 1);
  await disposeServers([server]);
  return start(config);
}

async function signIn(server: TestFetchServer): Promise<string> {
  const people = (server.instance.getScopes()[0] as Scope).httpRouteTable?.people;
  if (!people) throw new Error('people auth is not set up');
  const response = await server.handler(
    new Request(`${ORIGIN}/_frontmcp/people/login`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: people.createCode().code }),
    }),
  );
  expect(response.status).toBe(200);
  return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

async function openBoard(server: TestFetchServer, cookie: string): Promise<number> {
  return (await server.handler(new Request(`${ORIGIN}/board`, { headers: { cookie } }))).status;
}

describe('people sessions across a restart', () => {
  it('keep a browser signed in when the server has a sqlite store', async () => {
    const config = {
      sqlite: { path: join(dir, 'kept.sqlite') },
      http: { auth: { people: 'loopback-token' as const } },
    };
    const before = await start(config);
    const cookie = await signIn(before);
    expect(await openBoard(before, cookie)).toBe(200);

    const after = await restart(before, config);

    expect(await openBoard(after, cookie)).toBe(200);
    expect(await openBoard(after, 'frontmcp_people=forged')).toBe(401);
  });

  it('keep the sessions of two servers on one store apart', async () => {
    const path = join(dir, 'shared.sqlite');
    const desk = await start({ sqlite: { path }, http: { auth: { people: 'loopback-token' } } });
    const cookie = await signIn(desk);

    const other = await start({
      info: { name: 'other', version: '1.0.0' },
      sqlite: { path },
      http: { auth: { people: 'loopback-token' } },
    });

    expect(await openBoard(other, cookie)).toBe(401);
  });

  it('end on every server on the store when the person signs out on one of them', async () => {
    const config = {
      sqlite: { path: join(dir, 'instances.sqlite') },
      http: { auth: { people: 'loopback-token' as const } },
    };
    const first = await start(config);
    const second = await start(config);
    const cookie = await signIn(first);
    expect(await openBoard(second, cookie)).toBe(200);

    const people = (second.instance.getScopes()[0] as Scope).httpRouteTable?.people;
    people?.endSession(cookie.slice(cookie.indexOf('=') + 1));
    await people?.flush();

    expect(await openBoard(second, cookie)).toBe(401);
    expect(await openBoard(first, cookie)).toBe(401);
  });

  it('end with the process under store: false, as without a store', async () => {
    const config = {
      sqlite: { path: join(dir, 'memory.sqlite') },
      http: { auth: { people: { mode: 'loopback-token' as const, store: false as const } } },
    };
    const before = await start(config);
    const cookie = await signIn(before);

    const after = await restart(before, config);

    expect(await openBoard(after, cookie)).toBe(401);
  });

  it('end with the process when the server has no store', async () => {
    const config = { http: { auth: { people: 'loopback-token' as const } } };
    const before = await start(config);
    const cookie = await signIn(before);

    const after = await restart(before, config);

    expect(await openBoard(after, cookie)).toBe(401);
  });
});
