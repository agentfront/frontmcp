import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { App, frontMcpMetadataSchema, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';

@Tool({ name: 'export_report', inputSchema: {}, execution: { taskSupport: 'optional' } })
class ExportReportTool extends ToolContext {
  async execute() {
    return 'done';
  }
}

@App({ id: 'reports', name: 'Reports', tools: [ExportReportTool] })
class ReportsApp {}

describe('the task runner a scope installs', () => {
  let dir: string;
  const instances: FrontMcpInstance[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-task-runner-'));
  });

  afterAll(async () => {
    for (const instance of instances) await instance.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  async function startWith(tasks: FrontMcpConfigInput['tasks']): Promise<Scope> {
    const config: FrontMcpConfigInput = {
      info: { name: 'task-runner', version: '1.0.0' },
      apps: [ReportsApp],
      tasks,
      logging: { level: LogLevel.Off },
    };
    const instance = new FrontMcpInstance(frontMcpMetadataSchema.parse(config));
    instances.push(instance);
    await instance.ready;
    return instance.getPrimaryScope() as Scope;
  }

  it('runs tasks in process by default', async () => {
    const scope = await startWith({});

    expect(scope.tasks?.runner?.kind).toBe('in-process');
  });

  it("spawns workers with tasks.runner: 'cli'", async () => {
    const scope = await startWith({ runner: 'cli', sqlite: { path: path.join(dir, 'tasks.db') } });

    expect(scope.tasks?.runner?.kind).toBe('cli');
  });

  it("refuses tasks.runner: 'cli' without a store a worker can share", async () => {
    await expect(startWith({ runner: 'cli' })).rejects.toThrow('requires a persistent backend');
  });
});
