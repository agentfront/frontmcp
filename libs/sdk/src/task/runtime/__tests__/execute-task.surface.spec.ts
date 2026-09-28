/**
 * A detached task worker runs a task on the surface of the call that created it.
 *
 * With `tasks.runner: 'cli'`, a task-augmented `tools/call` is run later by a worker process, which
 * rebuilt the call from the stored record without its surface. The tool then ran as in-process
 * dispatch: `getCallSurface()` was undefined inside it, so anything it does for the caller (CodeCall
 * running tools, say) was no longer judged for that caller.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { App, frontMcpMetadataSchema, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';
import { getCallSurface } from '../../../context/call-surface';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import type { Scope } from '../../../scope/scope.instance';
import type { TaskRecord } from '../../task.types';
import { executeTaskWorker } from '../execute-task';

@Tool({ name: 'report_surface', inputSchema: {}, execution: { taskSupport: 'optional' } })
class ReportSurfaceTool extends ToolContext {
  async execute() {
    return { surface: getCallSurface() ?? 'none' };
  }
}

@App({ id: 'ops', name: 'Ops', tools: [ReportSurfaceTool] })
class OpsApp {}

const SESSION_ID = 'task-surface-session';

describe('task worker surface', () => {
  let dir: string;
  let config: FrontMcpConfigInput;
  let host: FrontMcpInstance;
  let scope: Scope;
  const previousLogDir = process.env['FRONTMCP_LOG_DIR'];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-task-surface-'));
    process.env['FRONTMCP_LOG_DIR'] = path.join(dir, 'logs');
    config = {
      info: { name: 'task-surface', version: '1.0.0' },
      apps: [OpsApp],
      tasks: { sqlite: { path: path.join(dir, 'tasks.db') } },
      logging: { level: LogLevel.Off },
    };
    host = new FrontMcpInstance(frontMcpMetadataSchema.parse(config));
    await host.ready;
    scope = host.getPrimaryScope() as Scope;
  });

  afterAll(async () => {
    await (scope.taskStore as unknown as { destroy?: () => Promise<void> } | undefined)?.destroy?.();
    if (previousLogDir === undefined) delete process.env['FRONTMCP_LOG_DIR'];
    else process.env['FRONTMCP_LOG_DIR'] = previousLogDir;
    await rm(dir, { recursive: true, force: true });
  });

  async function stored(taskId: string): Promise<TaskRecord | null> {
    const store = scope.taskStore;
    if (!store) throw new Error('expected a task store');
    return store.get(taskId, SESSION_ID);
  }

  async function settled(taskId: string): Promise<TaskRecord | null> {
    for (let i = 0; i < 50 && (await stored(taskId))?.status === 'working'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return stored(taskId);
  }

  it('records the surface of the call that creates a task', async () => {
    const created = (await scope.runFlowForOutput('tools:call-tool', {
      request: { method: 'tools/call', params: { name: 'report_surface', arguments: {}, task: { ttl: 60_000 } } },
      ctx: { authInfo: { sessionId: SESSION_ID }, surface: 'mcp' },
    })) as unknown as { task: { taskId: string } };

    const record = await settled(created.task.taskId);
    expect(record?.surface).toBe('mcp');
  });

  it('runs the task on that surface', async () => {
    const now = Date.now();
    const store = scope.taskStore;
    if (!store) throw new Error('expected a task store');
    await store.create({
      taskId: 'task-mcp',
      sessionId: SESSION_ID,
      status: 'working',
      createdAt: new Date(now).toISOString(),
      lastUpdatedAt: new Date(now).toISOString(),
      ttlMs: 60_000,
      expiresAt: now + 60_000,
      request: { method: 'tools/call', params: { name: 'report_surface', arguments: {} } },
      scopeId: scope.id,
      surface: 'mcp',
    });

    await executeTaskWorker(config, 'task-mcp');

    const record = await stored('task-mcp');
    expect(record?.status).toBe('completed');
    expect(JSON.stringify(record?.outcome)).toContain('"surface":"mcp"');
  });
});
