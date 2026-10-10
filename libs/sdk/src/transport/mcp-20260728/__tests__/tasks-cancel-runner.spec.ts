import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';
import { type Scope } from '../../../scope/scope.instance';
import { type TaskRunner } from '../../../task/helpers/task-runner.types';

const KEY = 'sk-tasks-cancel-0001';
const TASKS_EXT = { extensions: { 'io.modelcontextprotocol/tasks': {} } };
const auth = { authorization: `Bearer ${KEY}` };

@Tool({ name: 'long_export', inputSchema: {}, execution: { taskSupport: 'optional' } })
class LongExportTool extends ToolContext {
  async execute() {
    return { done: true };
  }
}

@App({ id: 'exports', name: 'Exports', tools: [LongExportTool] })
class ExportsApp {}

describe('tasks/cancel under protocol 2026-07-28', () => {
  let server: TestFetchServer;
  const detachedRunner: jest.Mocked<TaskRunner> = {
    kind: 'cli',
    run: jest.fn(async () => undefined),
    cancel: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'tasks-cancel-runner', version: '1.0.0' },
      apps: [ExportsApp],
      auth: { mode: 'static', tokens: [KEY] },
      tasks: { enabled: true, defaultTtlMs: 60_000 },
    });
    const scope = server.instance.getScopes()[0] as Scope;
    scope.tasks?.setRunner(detachedRunner);
  });

  it('asks the runner to stop the task, as a 2025-11-25 tasks/cancel does', async () => {
    const created = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'long_export', arguments: {} },
      { capabilities: TASKS_EXT, headers: auth },
    );
    const taskId = (created.message.result as { task?: { taskId?: string } } | undefined)?.task?.taskId;
    if (!taskId) throw new Error(`no task was created: ${JSON.stringify(created.message)}`);

    const cancelled = await rpc20260728(
      server.handler,
      'tasks/cancel',
      { taskId },
      { capabilities: TASKS_EXT, headers: auth },
    );

    expect(cancelled.message.error).toBeUndefined();
    expect(detachedRunner.cancel).toHaveBeenCalledWith(expect.objectContaining({ taskId, status: 'cancelled' }));

    const polled = await rpc20260728(
      server.handler,
      'tasks/get',
      { taskId },
      { capabilities: TASKS_EXT, headers: auth },
    );
    expect(polled.message.result?.['status']).toBe('cancelled');
  });

  it('acknowledges a cancel of a task that already finished, without signalling the runner again', async () => {
    const created = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'long_export', arguments: {} },
      { capabilities: TASKS_EXT, headers: auth },
    );
    const taskId = (created.message.result as { task: { taskId: string } }).task.taskId;
    await rpc20260728(server.handler, 'tasks/cancel', { taskId }, { capabilities: TASKS_EXT, headers: auth });
    detachedRunner.cancel.mockClear();

    const again = await rpc20260728(
      server.handler,
      'tasks/cancel',
      { taskId },
      { capabilities: TASKS_EXT, headers: auth },
    );

    expect(again.message.error).toBeUndefined();
    expect(detachedRunner.cancel).not.toHaveBeenCalled();
  });

  it('answers an unknown task with Task not found', async () => {
    const response = await rpc20260728(
      server.handler,
      'tasks/cancel',
      { taskId: 'no-such-task' },
      { capabilities: TASKS_EXT, headers: auth },
    );

    expect(response.message.error).toEqual(expect.objectContaining({ code: -32602, message: 'Task not found' }));
  });
});
