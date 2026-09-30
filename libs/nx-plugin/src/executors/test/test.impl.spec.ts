import { execFileSync } from 'child_process';
import { join } from 'path';

import { createFakeWorkspace, type FakeWorkspace } from '../__tests__/fake-workspace';
import testExecutor from './test.impl';

jest.mock('child_process', () => ({ execFileSync: jest.fn(), spawn: jest.fn() }));

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe('test executor', () => {
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

  it('runs frontmcp test from the project folder, not the workspace root', async () => {
    const result = await testExecutor({}, ws.context);

    expect(result.success).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      process.execPath,
      [ws.binPath, 'test'],
      expect.objectContaining({ cwd: join(ws.root, 'apps', 'demo') }),
    );
  });

  it('passes all flags', async () => {
    await testExecutor({ runInBand: true, watch: true, coverage: true, verbose: true, timeout: 5000 }, ws.context);

    expect(lastArgs()).toEqual([
      ws.binPath,
      'test',
      '--runInBand',
      '--watch',
      '--coverage',
      '--verbose',
      '--timeout',
      '5000',
    ]);
  });

  it('reports failure when tests fail', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('failed'), { status: 1 });
    });
    expect(await testExecutor({}, ws.context)).toEqual({ success: false });
  });
});
