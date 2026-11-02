import { EventEmitter } from 'node:events';

import { SHARED_SERVE_ENV, SHARED_START_LOCK_ENV, spawnSharedServer } from '../ensure-shared-server';

class FakeChild extends EventEmitter {
  readonly unref = jest.fn();
}

const spawn = jest.fn();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  getSpawnFn: () => spawn,
}));

describe('spawnSharedServer', () => {
  let child: FakeChild;

  beforeEach(() => {
    child = new FakeChild();
    spawn.mockReset().mockReturnValue(child);
  });

  it("runs this process's entry again, detached and unwatched, as the key's server", () => {
    const spawned = spawnSharedServer('notes', 'holder-1');

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [...process.execArgv, ...process.argv.slice(1)],
      expect.objectContaining({ cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true }),
    );
    const [, , options] = spawn.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(options.env[SHARED_SERVE_ENV]).toBe('notes');
    expect(options.env[SHARED_START_LOCK_ENV]).toBe('holder-1');
    expect(child.unref).toHaveBeenCalled();
    expect(spawned.exitReason).toBeUndefined();
  });

  it('reports why the server can no longer come up', () => {
    const exited = spawnSharedServer('notes', 'holder-1');
    child.emit('exit', 1, null);
    expect(exited.exitReason).toBe('it exited with code 1');

    child = new FakeChild();
    spawn.mockReturnValue(child);
    const killed = spawnSharedServer('notes', 'holder-1');
    child.emit('exit', null, 'SIGKILL');
    expect(killed.exitReason).toBe('it exited with SIGKILL');

    child = new FakeChild();
    spawn.mockReturnValue(child);
    const missing = spawnSharedServer('notes', 'holder-1');
    child.emit('error', new Error('spawn ENOENT'));
    child.emit('exit', -2, null);
    expect(missing.exitReason).toBe('it could not be started (spawn ENOENT)');
  });
});
