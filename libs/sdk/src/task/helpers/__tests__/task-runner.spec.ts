import { createMemoryStorage } from '@frontmcp/utils';

import { StorageTaskStore } from '../../store/storage-task.store';
import { TaskRegistry } from '../../task.registry';
import type { TaskRecord } from '../../task.types';
import type { TaskNotifier } from '../task-notifier';
import { runTaskInBackground } from '../task-runner';

const OWNER = 'session-runner';

function newTask(taskId: string): TaskRecord {
  const now = Date.now();
  return {
    taskId,
    sessionId: OWNER,
    status: 'working',
    createdAt: new Date(now).toISOString(),
    lastUpdatedAt: new Date(now).toISOString(),
    ttlMs: 60_000,
    expiresAt: now + 60_000,
    request: { method: 'tools/call', params: { name: 'export_report', arguments: {} } },
  };
}

describe('runTaskInBackground when its own bookkeeping fails', () => {
  const previousNodeEnv = process.env['NODE_ENV'];
  let store: StorageTaskStore;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'production';
    const storage = createMemoryStorage({ prefix: 'mcp:task:' });
    await storage.connect();
    store = new StorageTaskStore(storage);
  });

  afterEach(async () => {
    process.env['NODE_ENV'] = previousNodeEnv;
    jest.restoreAllMocks();
    await store.destroy();
  });

  it('marks the task failed without the internal message, and frees its concurrency slot', async () => {
    const crashed = newTask('task-crashed');
    await store.createWithinLimit(crashed, 1);
    jest.spyOn(store, 'get').mockRejectedValueOnce(new Error('task store at 10.0.4.7:6379 is unreachable'));

    await runTaskInBackground({
      record: crashed,
      cleanedRequestParams: crashed.request.params,
      ctx: {},
      scope: { runFlowForOutput: jest.fn(async () => ({ content: [] })) } as never,
      store,
      registry: new TaskRegistry(),
      notifier: { sendStatus: jest.fn() } as unknown as TaskNotifier,
    });

    const record = await store.get(crashed.taskId, OWNER);
    expect(record?.status).toBe('failed');
    expect(record?.statusMessage).toMatch(/^Internal FrontMCP error/);
    expect(JSON.stringify(record)).not.toContain('10.0.4.7');
    expect(await store.createWithinLimit(newTask('task-next'), 1)).toBe(true);
  });
});
