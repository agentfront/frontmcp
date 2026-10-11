import { getHostname } from '@frontmcp/utils';

import type { TaskRecord } from '../../task.types';
import { CliTaskRunner } from '../cli-task-runner';

const WORKER_PID = 4242;

function runningTask(executor: TaskRecord['executor']): TaskRecord {
  const now = new Date().toISOString();
  return {
    taskId: 'task-cancel',
    sessionId: 'session-cancel',
    status: 'cancelled',
    createdAt: now,
    lastUpdatedAt: now,
    ttlMs: 60_000,
    expiresAt: Date.now() + 60_000,
    request: { method: 'tools/call', params: { name: 'export_report', arguments: {} } },
    executor,
  };
}

describe('CliTaskRunner.cancel', () => {
  let kill: jest.SpyInstance;
  const logger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const runner = new CliTaskRunner({ store: {} as never, logger: logger as never });

  beforeEach(() => {
    kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('sends SIGTERM to a worker on this host', async () => {
    await runner.cancel(runningTask({ host: 'cli', pid: WORKER_PID, hostname: getHostname() }));

    expect(kill).toHaveBeenCalledWith(WORKER_PID, 'SIGTERM');
  });

  it('sends SIGTERM to a worker recorded without a host', async () => {
    await runner.cancel(runningTask({ host: 'cli', pid: WORKER_PID }));

    expect(kill).toHaveBeenCalledWith(WORKER_PID, 'SIGTERM');
  });

  it('signals nothing for a worker on another host', async () => {
    await runner.cancel(runningTask({ host: 'cli', pid: WORKER_PID, hostname: 'another-host.internal' }));

    expect(kill).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('another host'),
      expect.objectContaining({ taskId: 'task-cancel', hostname: 'another-host.internal' }),
    );
  });
});

describe('CliTaskRunner.run', () => {
  it("records the worker's pid and this host's name", async () => {
    const update = jest.fn(async () => null);
    const runner = new CliTaskRunner({
      store: { update } as never,
      command: { exe: process.execPath, args: ['-e', ''] },
    });

    await runner.run(runningTask(undefined), { cleanedRequestParams: {}, ctx: {} });

    expect(update).toHaveBeenCalledWith(
      'task-cancel',
      'session-cancel',
      expect.objectContaining({
        executor: expect.objectContaining({ host: 'cli', pid: expect.any(Number), hostname: getHostname() }),
      }),
    );
  });
});
