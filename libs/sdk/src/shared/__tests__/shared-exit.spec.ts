/**
 * A shared local server exits on its own: drained by a session of a newer version, idle, or once its checkout is
 * removed. It then refuses new requests as `exiting`, lets those in flight finish, and removes its record and socket.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSharedServerNonce, deriveSharedServerKeys } from '@frontmcp/auth';

import { post } from '../../__test-utils__/helpers/shared-session-client';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { SHARED_DRAIN_PATH, SHARED_IDENTIFY_PATH, SHARED_STATE_HEADER } from '../shared-endpoint';
import { readServerRecord, sharedServerFiles, type SharedServerRecord } from '../shared-files';
import { serveShared, type ServeSharedOptions, type SharedServerHandle } from '../shared-serve';
import { parseSharedServerOptions } from '../shared-server.options';

@Tool({ name: 'slow', inputSchema: {} })
class SlowTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return { finished: true };
  }
}

@App({ id: 'exit', name: 'Exit', tools: [SlowTool] })
class ExitApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'shared-exit-spec', version: '1.0.0' },
  apps: [ExitApp],
  logging: { level: LogLevel.Off, enableConsole: false },
};

const create = (parsed: ConstructorParameters<typeof FrontMcpInstance>[0]) => new FrontMcpInstance(parsed);

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'exit-spec', version: '1.0.0' } },
};

async function waitUntil(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

posixOnly('a shared local server exiting on its own', () => {
  let home: string;
  let previousHome: string | undefined;
  let servers: SharedServerHandle[];
  let exit: jest.Mock;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-exit-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    servers = [];
    exit = jest.fn();
  });

  afterEach(async () => {
    for (const server of servers) await server.close();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function serve(
    transport: 'unix' | 'http',
    shared: Record<string, unknown> = {},
    overrides: Partial<ServeSharedOptions> = {},
  ): Promise<SharedServerRecord> {
    const options = parseSharedServerOptions({
      key: 'spec',
      transport,
      idleTimeoutMs: false,
      checkout: false,
      ...shared,
    });
    servers.push(await serveShared({ config, options, create, exit, watchIntervalMs: 50, ...overrides }));
    const record = await readServerRecord(sharedServerFiles('spec'));
    if (!record) throw new Error('the shared server wrote no record');
    return record;
  }

  async function initialized(record: SharedServerRecord, token: string): Promise<Record<string, string>> {
    const answer = await post(record, record.path, { authorization: `Bearer ${token}` }, initialize);
    expect(answer.status).toBe(200);
    return { authorization: `Bearer ${token}`, 'mcp-session-id': String(answer.headers['mcp-session-id']) };
  }

  describe('its drain endpoint', () => {
    it('refuses a drain without its token', async () => {
      const record = await serve('http');

      expect((await post(record, SHARED_DRAIN_PATH, {}, { version: '2.0.0' })).status).toBe(401);
      expect(
        (await post(record, SHARED_DRAIN_PATH, { authorization: 'Bearer wrong' }, { version: '2.0.0' })).status,
      ).toBe(401);
      expect(exit).not.toHaveBeenCalled();
    });

    it.each([
      ['the same version', '1.0.0'],
      ['an older version', '0.9.0'],
      ['a version it can not order', 'nightly'],
    ])('never lets a session of %s make it exit, and keeps serving', async (_, version) => {
      const record = await serve('http');
      const { token } = deriveSharedServerKeys(record.secret);

      const answer = await post(record, SHARED_DRAIN_PATH, { authorization: `Bearer ${token}` }, { version });

      expect(answer.status).toBe(409);
      expect(JSON.parse(answer.body)).toEqual({
        error: 'only a session of a newer version replaces this server',
        version: '1.0.0',
      });
      await initialized(record, token);
      expect(fs.existsSync(sharedServerFiles('spec').recordFile)).toBe(true);
      expect(exit).not.toHaveBeenCalled();
    });

    it('refuses a drain that does not say its version', async () => {
      const record = await serve('http');
      const { token } = deriveSharedServerKeys(record.secret);
      for (const body of [
        {},
        { version: 42 },
        { version: '' },
        { version: '1'.repeat(257) },
        { version: '9.0.0\nx' },
      ]) {
        expect((await post(record, SHARED_DRAIN_PATH, { authorization: `Bearer ${token}` }, body)).status).toBe(400);
      }
    });

    it('drains for a newer session: refuses new requests, finishes the one in flight, then exits', async () => {
      const record = await serve('http');
      const { token } = deriveSharedServerKeys(record.secret);
      const session = await initialized(record, token);
      const inFlight = post(record, record.path, session, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'slow', arguments: {} },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const drained = await post(record, SHARED_DRAIN_PATH, { authorization: `Bearer ${token}` }, { version: '2.0.0' });
      expect(drained.status).toBe(202);
      await waitUntil(() => !fs.existsSync(sharedServerFiles('spec').recordFile), 'the record to be removed');

      const refused = await post(record, record.path, session, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
      expect(refused.status).toBe(503);
      expect(refused.headers[SHARED_STATE_HEADER]).toBe('exiting');
      const challenge = await post(record, SHARED_IDENTIFY_PATH, {}, { nonce: createSharedServerNonce() });
      expect(challenge.status).toBe(503);
      expect(challenge.headers[SHARED_STATE_HEADER]).toBe('exiting');

      const finished = await inFlight;
      expect(finished.status).toBe(200);
      expect(finished.body).toContain('finished');
      await waitUntil(() => exit.mock.calls.length > 0, 'the server to exit');
      expect(exit).toHaveBeenCalledWith(0);
      servers.pop();
    });
  });

  describe.each(['unix', 'http'] as const)('over %s', (transport) => {
    it('exits once it had no request for its idle time, removing its record and socket', async () => {
      await serve(transport, { idleTimeoutMs: 300 });
      const files = sharedServerFiles('spec');
      expect(exit).not.toHaveBeenCalled();

      await waitUntil(() => exit.mock.calls.length > 0, 'the idle server to exit');

      expect(exit).toHaveBeenCalledWith(0);
      expect(fs.existsSync(files.recordFile)).toBe(false);
      expect(fs.existsSync(files.socketPath)).toBe(false);
      servers.pop();
    });

    it('exits once its checkout is removed', async () => {
      const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-checkout-'));
      await serve(transport, { checkout });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(exit).not.toHaveBeenCalled();

      fs.rmSync(checkout, { recursive: true, force: true });
      await waitUntil(() => exit.mock.calls.length > 0, 'the server to exit');

      expect(exit).toHaveBeenCalledWith(0);
      expect(fs.existsSync(sharedServerFiles('spec').recordFile)).toBe(false);
      expect(fs.existsSync(sharedServerFiles('spec').socketPath)).toBe(false);
      servers.pop();
    });
  });

  it('is not idle while a request is in flight, nor right after a session challenged it', async () => {
    const record = await serve('http', { idleTimeoutMs: 400 });
    const { token } = deriveSharedServerKeys(record.secret);
    const session = await initialized(record, token);
    const call = post(record, record.path, session, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'slow', arguments: {} },
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(exit).not.toHaveBeenCalled();
    expect((await call).body).toContain('finished');

    for (let challenge = 0; challenge < 4; challenge++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await post(record, SHARED_IDENTIFY_PATH, {}, { nonce: createSharedServerNonce() });
    }
    expect(exit).not.toHaveBeenCalled();
    await waitUntil(() => exit.mock.calls.length > 0, 'the idle server to exit');
    servers.pop();
  });

  it('is not kept running by requests that lack its token', async () => {
    const record = await serve('http', { idleTimeoutMs: 400 });
    const started = Date.now();
    const knocking = setInterval(() => void post(record, record.path, {}, initialize).catch(() => undefined), 50);
    try {
      await waitUntil(() => exit.mock.calls.length > 0, 'the idle server to exit');
    } finally {
      clearInterval(knocking);
    }
    expect(Date.now() - started).toBeLessThan(3_000);
    servers.pop();
  });

  it('refuses new requests, removes its record and shuts down when it is stopped, without exiting itself', async () => {
    const record = await serve('unix');
    await (servers.pop() as SharedServerHandle).close();

    expect(fs.existsSync(sharedServerFiles('spec').recordFile)).toBe(false);
    expect(fs.existsSync(sharedServerFiles('spec').socketPath)).toBe(false);
    expect(record.pid).toBe(process.pid);
    expect(exit).not.toHaveBeenCalled();
  });
});
