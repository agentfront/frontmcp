import { EventEmitter } from 'events';

import { Supervisor } from '../spawn';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));
jest.mock('../log-utils', () => ({
  createLogStreams: () => ({ stdout: { write: jest.fn() }, stderr: { write: jest.fn() } }),
}));
const writePidFile = jest.fn();
jest.mock('../pidfile', () => ({ writePidFile: (...a: unknown[]) => writePidFile(...a), removePidFile: jest.fn() }));
jest.mock('../health', () => ({ checkHealth: jest.fn() }));

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { pid: number; stdout: null; stderr: null; kill: jest.Mock };
  child.pid = 4242;
  child.stdout = null;
  child.stderr = null;
  child.kill = jest.fn();
  return child;
}

describe('Supervisor environment (#642)', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    writePidFile.mockReset();
    spawnMock.mockReturnValue(fakeChild());
  });

  it('hands the socket to the SDK through FRONTMCP_DAEMON_SOCKET', async () => {
    const sup = new Supervisor({ name: 'a', entry: 'main.ts', socket: true, socketPath: '/tmp/a.sock' });
    await sup.start();
    await sup.stop(true);

    const env = spawnMock.mock.calls[0][2].env as Record<string, string>;
    expect(env['FRONTMCP_DAEMON_SOCKET']).toBe('/tmp/a.sock');
    expect(env['FRONTMCP_SOCKET_PATH']).toBeUndefined();
  });

  it('passes PORT and FRONTMCP_SQLITE_PATH', async () => {
    const sup = new Supervisor({ name: 'a', entry: 'main.ts', port: 4100, dbPath: '/tmp/a.sqlite' });
    await sup.start();
    await sup.stop(true);

    const env = spawnMock.mock.calls[0][2].env as Record<string, string>;
    expect(env['PORT']).toBe('4100');
    expect(env['FRONTMCP_SQLITE_PATH']).toBe('/tmp/a.sqlite');
  });

  it('records maxRestarts in the pid file so restart and service install can reuse it', async () => {
    const sup = new Supervisor({ name: 'a', entry: 'main.ts', maxRestarts: 7 });
    await sup.start();
    await sup.stop(true);

    expect(writePidFile.mock.calls[0][1]).toMatchObject({ maxRestarts: 7 });
  });
});
