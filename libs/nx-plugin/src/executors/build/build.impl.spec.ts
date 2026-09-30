import { execFileSync } from 'child_process';
import { join } from 'path';

import { createFakeWorkspace, type FakeWorkspace } from '../__tests__/fake-workspace';
import buildExecutor from './build.impl';

jest.mock('child_process', () => ({ execFileSync: jest.fn(), spawn: jest.fn() }));

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe('build executor', () => {
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

  it('runs the local frontmcp CLI from the project folder', async () => {
    const result = await buildExecutor({}, ws.context);

    expect(result.success).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      process.execPath,
      [ws.binPath, 'build'],
      expect.objectContaining({ cwd: join(ws.root, 'apps', 'demo') }),
    );
  });

  it('never uses npx', async () => {
    await buildExecutor({}, ws.context);
    expect(mockExecFileSync.mock.calls[0]?.[0]).not.toMatch(/npx/);
  });

  it('passes absolute entry and output paths because the CLI runs in the project folder', async () => {
    await buildExecutor({ entry: 'apps/demo/src/main.ts', outputPath: 'dist/apps/demo', target: 'vercel' }, ws.context);

    expect(lastArgs()).toEqual([
      ws.binPath,
      'build',
      '--target',
      'vercel',
      '--entry',
      join(ws.root, 'apps/demo/src/main.ts'),
      '--out-dir',
      join(ws.root, 'dist/apps/demo'),
    ]);
  });

  it('never passes --adapter, which the CLI does not know', async () => {
    await buildExecutor({ adapter: 'vercel' }, ws.context);

    expect(lastArgs()).not.toContain('--adapter');
    expect(lastArgs()).toEqual([ws.binPath, 'build', '--target', 'vercel']);
  });

  it('prefers target over the deprecated adapter alias', async () => {
    await buildExecutor({ target: 'lambda', adapter: 'vercel' }, ws.context);
    expect(lastArgs()).toEqual([ws.binPath, 'build', '--target', 'lambda']);
  });

  it('reports failure when the CLI fails', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('failed'), { status: 1 });
    });
    expect(await buildExecutor({}, ws.context)).toEqual({ success: false });
  });

});
