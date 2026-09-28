/**
 * The task worker runs a task through the scope that created it.
 *
 * With `tasks.runner: 'cli'`, every scope, a standalone app's included, writes its tasks to the same
 * backend, and a detached worker picks each one up. The worker ran every task through one scope
 * (the first, then the primary one), so a task created by a standalone app could not find its tool,
 * or ran a same-named tool of another app.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { App, frontMcpMetadataSchema, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import type { Scope } from '../../../scope/scope.instance';
import type { TaskRecord } from '../../task.types';
import { executeTaskWorker } from '../execute-task';

@Tool({ name: 'status', inputSchema: {}, execution: { taskSupport: 'optional' } })
class OpsStatusTool extends ToolContext {
  async execute() {
    return { from: 'ops' };
  }
}

@Tool({ name: 'status', inputSchema: {} })
class OrdersStatusTool extends ToolContext {
  async execute() {
    return { from: 'orders' };
  }
}

@App({ id: 'ops', name: 'Ops', standalone: true, tools: [OpsStatusTool] })
class OpsApp {}

@App({ id: 'orders', name: 'Orders', tools: [OrdersStatusTool] })
class OrdersApp {}

const SESSION_ID = 'task-scope-session';

describe('task worker scope', () => {
  let dir: string;
  let config: FrontMcpConfigInput;
  let host: FrontMcpInstance;
  let opsScope: Scope;
  let primaryScope: Scope;
  const previousLogDir = process.env['FRONTMCP_LOG_DIR'];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-task-scope-'));
    process.env['FRONTMCP_LOG_DIR'] = path.join(dir, 'logs');
    config = {
      info: { name: 'task-scope', version: '1.0.0' },
      apps: [OpsApp, OrdersApp],
      tasks: { sqlite: { path: path.join(dir, 'tasks.db') } },
      logging: { level: LogLevel.Off },
    };
    host = new FrontMcpInstance(frontMcpMetadataSchema.parse(config));
    await host.ready;
    primaryScope = host.getPrimaryScope() as Scope;
    const other = (host.getScopes() as Scope[]).find((scope) => scope !== primaryScope);
    if (!other) throw new Error('expected a standalone scope next to the primary one');
    opsScope = other;
  });

  afterAll(async () => {
    for (const scope of host.getScopes() as Scope[]) {
      await (scope.taskStore as unknown as { destroy?: () => Promise<void> } | undefined)?.destroy?.();
    }
    if (previousLogDir === undefined) delete process.env['FRONTMCP_LOG_DIR'];
    else process.env['FRONTMCP_LOG_DIR'] = previousLogDir;
    await rm(dir, { recursive: true, force: true });
  });

  async function createTask(taskId: string, scopeId?: string): Promise<void> {
    const now = Date.now();
    const record: TaskRecord = {
      taskId,
      sessionId: SESSION_ID,
      status: 'working',
      createdAt: new Date(now).toISOString(),
      lastUpdatedAt: new Date(now).toISOString(),
      ttlMs: 60_000,
      expiresAt: now + 60_000,
      request: { method: 'tools/call', params: { name: 'status', arguments: {} } },
      ...(scopeId ? { scopeId } : {}),
    };
    const store = primaryScope.taskStore;
    if (!store) throw new Error('expected a task store');
    await store.create(record);
  }

  async function finished(taskId: string): Promise<TaskRecord | null> {
    const store = primaryScope.taskStore;
    if (!store) throw new Error('expected a task store');
    return store.get(taskId, SESSION_ID);
  }

  it('records the scope that creates a task', async () => {
    const created = (await opsScope.runFlowForOutput('tools:call-tool', {
      request: { method: 'tools/call', params: { name: 'status', arguments: {}, task: { ttl: 60_000 } } },
      ctx: { authInfo: { sessionId: SESSION_ID } },
    })) as unknown as { task: { taskId: string } };

    const record = await finished(created.task.taskId);
    expect(record?.scopeId).toBe(opsScope.id);
    expect(opsScope.id).not.toBe(primaryScope.id);

    // Let the in-process runner finish before the stores close.
    for (let i = 0; i < 50 && (await finished(created.task.taskId))?.status === 'working'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  it('runs a standalone app task through that app’s scope', async () => {
    await createTask('task-ops', opsScope.id);

    const exitCode = await executeTaskWorker(config, 'task-ops');

    expect(exitCode).toBe(0);
    const record = await finished('task-ops');
    expect(record?.status).toBe('completed');
    expect(JSON.stringify(record?.outcome)).toContain('ops');
    expect(JSON.stringify(record?.outcome)).not.toContain('orders');
  });

  it('runs a task of the primary scope there', async () => {
    await createTask('task-orders', primaryScope.id);

    await executeTaskWorker(config, 'task-orders');

    const record = await finished('task-orders');
    expect(record?.status).toBe('completed');
    expect(JSON.stringify(record?.outcome)).toContain('orders');
  });

  it('runs a task recorded without a scope, by an earlier release, through the primary scope', async () => {
    await createTask('task-legacy');

    await executeTaskWorker(config, 'task-legacy');

    const record = await finished('task-legacy');
    expect(record?.status).toBe('completed');
    expect(JSON.stringify(record?.outcome)).toContain('orders');
  });

  it('does not run a task whose scope this server no longer has', async () => {
    await createTask('task-gone', 'removed-app');

    const exitCode = await executeTaskWorker(config, 'task-gone');

    expect(exitCode).not.toBe(0);
    const record = await finished('task-gone');
    expect(record?.status).toBe('failed');
    expect(JSON.stringify(record)).not.toContain('"from"');
  });
});
