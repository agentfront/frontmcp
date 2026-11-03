import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { createSharedServerSecret } from '@frontmcp/auth';

import { startIdentityStub, type IdentityStub } from '../../__test-utils__/helpers/shared-server-stub';
import { clientOf, initialize } from '../../__test-utils__/helpers/shared-session-client';
import { SharedServerIdentityError } from '../../errors';
import { attachSharedSession, SharedServerLostError, towardsServer } from '../shared-attach';
import { SHARED_STATE_HEADER } from '../shared-endpoint';
import { prepareSharedDirectory, sharedServerFiles, writeServerRecord } from '../shared-files';
import { parseSharedServerOptions } from '../shared-server.options';
import { unixSocketFetch } from '../unix-socket-fetch';

function failing(error: unknown): typeof fetch {
  return async () => {
    throw error;
  };
}

function answering(status: number, headers: Record<string, string> = {}): typeof fetch {
  return async () => new Response(status === 204 ? null : '{}', { status, headers });
}

function codeError(code: string, viaCause = false): Error {
  const coded = Object.assign(new Error(code), { code });
  return viaCause ? new TypeError('fetch failed', { cause: coded }) : coded;
}

describe('towardsServer', () => {
  it.each([
    ['nothing listens on its port', codeError('ECONNREFUSED', true)],
    ['its socket is gone', codeError('ENOENT')],
    ['its endpoint no longer proves its identity', new SharedServerIdentityError('http://127.0.0.1:1')],
  ])('reports a server that went away before the request reached it when %s', async (_, error) => {
    const outcome = await towardsServer(failing(error))('http://localhost/', { method: 'POST' }).catch((e) => e);
    expect(outcome).toBeInstanceOf(SharedServerLostError);
    expect((outcome as SharedServerLostError).reached).toBe(false);
  });

  it('reports a server whose connection dropped as one the request may have reached', async () => {
    const outcome = await towardsServer(failing(codeError('ECONNRESET')))('http://localhost/').catch((e) => e);
    expect(outcome).toBeInstanceOf(SharedServerLostError);
    expect((outcome as SharedServerLostError).reached).toBe(true);
  });

  it('passes an aborted request on as it is', async () => {
    const aborted = new DOMException('aborted', 'AbortError');
    const signal = AbortSignal.abort();
    await expect(towardsServer(failing(aborted))('http://localhost/', { signal })).rejects.toBe(aborted);
  });

  it.each([
    ['a server that no longer knows the token', 401, {}, 'it no longer knows the token'],
    ['a server that is exiting', 503, { [SHARED_STATE_HEADER]: 'exiting' }, 'it is exiting'],
  ])('reports %s as one the request never reached', async (_, status, headers, reason) => {
    const outcome = await towardsServer(answering(status, headers))('http://localhost/').catch((e) => e);
    expect(outcome).toEqual(new SharedServerLostError(false, reason));
    expect((outcome as SharedServerLostError).reached).toBe(false);
  });

  it('returns any other answer, a plain 503 included', async () => {
    for (const status of [200, 204, 404, 503]) {
      expect((await towardsServer(answering(status))('http://localhost/')).status).toBe(status);
    }
  });
});

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

// Each test starts real servers, with their SQLite start lock, and attaches sessions to them.
jest.setTimeout(20_000);

posixOnly('attachSharedSession against a server that keeps refusing its token', () => {
  let home: string;
  let previousHome: string | undefined;
  let stub: IdentityStub | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-attach-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
  });

  afterEach(async () => {
    await stub?.close();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('takes a request written to a socket whose server died before reading it as one that may have reached it', async () => {
    const socketPath = path.join(home, 'dying.sock');
    const dying = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => dying.listen(socketPath, resolve));
    try {
      const outcome = await towardsServer(unixSocketFetch(socketPath))('http://localhost/', {
        method: 'POST',
        body: '{}',
      }).catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(SharedServerLostError);
      expect((outcome as SharedServerLostError).reached).toBe(true);
    } finally {
      await new Promise<void>((resolve) => dying.close(() => resolve()));
    }
    const gone = await towardsServer(unixSocketFetch(socketPath))('http://localhost/').catch((error: unknown) => error);
    expect((gone as SharedServerLostError).reached).toBe(false);
  });

  it('sends a request no server took again a few times, then answers it instead of looping', async () => {
    const secret = createSharedServerSecret();
    const files = sharedServerFiles('spec');
    await prepareSharedDirectory(files);
    stub = await startIdentityStub({ secret, behavior: 'prove', status: 401 });
    await writeServerRecord(files, { name: 'spec', transport: 'http', port: stub.port, path: '/mcp', pid: 1, secret });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const input = new PassThrough();
    const output = new PassThrough();
    const session = attachSharedSession({
      ...parseSharedServerOptions({ key: 'spec', transport: 'http', idleTimeoutMs: false, checkout: false }),
      name: 'spec',
      version: '1.0.0',
      input,
      output,
      embed: () => Promise.reject(new Error('the session should not run the server itself')),
      spawnServer: () => {
        throw new Error('no server should be started');
      },
    });
    try {
      const answer = await clientOf(input, output).request(initialize);

      expect(answer.error).toMatchObject({ message: 'dev_server_unreachable', data: { reason: 'forward_failed' } });
      const initializes = (stub?.requests ?? []).filter(({ path: requested }) => requested === '/mcp');
      expect(initializes).toHaveLength(4);
    } finally {
      stderr.mockRestore();
      await session.stop();
    }
  });
});
