import { execFileSync } from 'child_process';
import { join } from 'path';

import { createFakeWorkspace, type FakeWorkspace } from '../__tests__/fake-workspace';
import buildExecExecutor from './build-exec.impl';

jest.mock('child_process', () => ({ execFileSync: jest.fn(), spawn: jest.fn() }));

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe('build-exec executor', () => {
  let ws: FakeWorkspace;

  beforeEach(() => {
    jest.clearAllMocks();
    ws = createFakeWorkspace();
  });
  afterEach(() => ws.cleanup());

  function lastArgs(): string[] {
    const call = mockExecFileSync.mock.calls[0];
    return (call?.[1] ?? []) as string[];
  }

  it('builds the node executable bundle from the project folder', async () => {
    const result = await buildExecExecutor({}, ws.context);

    expect(result.success).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      process.execPath,
      [ws.binPath, 'build', '--target', 'node'],
      expect.objectContaining({ cwd: join(ws.root, 'apps', 'demo') }),
    );
  });

  it('passes absolute entry and output paths', async () => {
    await buildExecExecutor({ entry: 'apps/demo/src/main.ts', outputPath: 'dist/apps/demo' }, ws.context);

    expect(lastArgs()).toEqual([
      ws.binPath,
      'build',
      '--target',
      'node',
      '--entry',
      join(ws.root, 'apps/demo/src/main.ts'),
      '--out-dir',
      join(ws.root, 'dist/apps/demo'),
    ]);
  });

  it('reports failure when the CLI is not installed', async () => {
    const bare = createFakeWorkspace({ installCli: false });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await buildExecExecutor({}, bare.context)).toEqual({ success: false });
    expect(mockExecFileSync).not.toHaveBeenCalled();
    spy.mockRestore();
    bare.cleanup();
  });
});
