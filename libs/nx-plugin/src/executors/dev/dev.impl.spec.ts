import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { join } from 'path';

import { createFakeWorkspace, type FakeWorkspace } from '../__tests__/fake-workspace';
import devExecutor from './dev.impl';

jest.mock('child_process', () => ({ execFileSync: jest.fn(), spawn: jest.fn() }));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & { killed: boolean; kill: jest.Mock };
  child.killed = false;
  child.kill = jest.fn(() => {
    child.killed = true;
  });
  return child;
}

describe('dev executor', () => {
  let ws: FakeWorkspace;

  beforeEach(() => {
    jest.clearAllMocks();
    ws = createFakeWorkspace();
  });
  afterEach(() => ws.cleanup());

  async function run(options: Parameters<typeof devExecutor>[0], exit: number | null = 0) {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);
    const gen = devExecutor(options, ws.context);
    const first = await gen.next();
    const secondPromise = gen.next();
    child.emit('close', exit);
    const second = await secondPromise;
    return { child, first, second };
  }

  function spawnedArgs(): string[] {
    return (mockSpawn.mock.calls[0]?.[1] ?? []) as string[];
  }

  it('spawns the local frontmcp CLI from the project folder without npx', async () => {
    const { first, second } = await run({});

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [ws.binPath, 'dev'],
      expect.objectContaining({ cwd: join(ws.root, 'apps', 'demo') }),
    );
    expect(first.value?.success).toBe(true);
    expect(second.value?.success).toBe(true);
  });

  it('passes an absolute entry', async () => {
    await run({ entry: 'apps/demo/src/main.ts' });
    expect(spawnedArgs()).toEqual([ws.binPath, 'dev', '--entry', join(ws.root, 'apps/demo/src/main.ts')]);
  });

  it('passes the port and reports the base url', async () => {
    const { first } = await run({ port: 4000 });
    expect(spawnedArgs()).toEqual([ws.binPath, 'dev', '--port', '4000']);
    expect(first.value).toEqual({ success: true, baseUrl: 'http://localhost:4000' });
  });

  it('omits baseUrl when no port is given', async () => {
    const { first } = await run({});
    expect(first.value).toEqual({ success: true });
  });

  it('reports failure on a non-zero exit code', async () => {
    const { second } = await run({}, 1);
    expect(second.value?.success).toBe(false);
  });

  it('reports failure when close emits null', async () => {
    const { second } = await run({}, null);
    expect(second.value?.success).toBe(false);
  });

  it('reports failure on an error event', async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);
    const gen = devExecutor({}, ws.context);
    await gen.next();
    const secondPromise = gen.next();
    child.emit('error', new Error('spawn failed'));
    expect((await secondPromise).value?.success).toBe(false);
  });

  it('kills the child when the generator finishes and the child is alive', async () => {
    const { child } = await run({});
    expect(child.kill).toHaveBeenCalled();
  });

  it('fails without spawning when the CLI is not installed', async () => {
    const bare = createFakeWorkspace({ installCli: false });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const gen = devExecutor({}, bare.context);
    expect((await gen.next()).value?.success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
    spy.mockRestore();
    bare.cleanup();
  });
});
