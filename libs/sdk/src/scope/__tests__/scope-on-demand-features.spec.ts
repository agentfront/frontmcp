/**
 * Features a server only needs when its config asks for them are loaded with `import()` (#827), so a browser
 * bundle of create() keeps them in chunks of their own: a server that doesn't use one never loads it, and one
 * that does has it before create() resolves.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, frontMcpMetadataSchema, Job, JobContext, LogLevel, Tool, ToolContext } from '../../common';
import { connect } from '../../direct/connect';
import { create } from '../../direct/create';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../scope.instance';

const ON_DEMAND_MODULES = [
  '../../channel/channel-scope.helper',
  '../../elicitation/flows',
  '../../elicitation/send-elicitation-result.tool',
  '../../elicitation/store/elicitation-store.factory',
  '../../ha',
  '../../job/job-scope.helper',
  '../../mcp-registry/mcp-registry-scope.helper',
  '../observability-scope.helper',
  '../../transport/bus',
  '../../transport/event-stores',
  '../../transport/ipc-server.transport',
  '../../transport/relay/relay-scope.helper',
  '../../transport/web-fetch-handler',
];

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@Job({ name: 'count', inputSchema: {}, outputSchema: { counted: z.boolean() } })
class CountJob extends JobContext {
  async execute() {
    return { counted: true };
  }
}

@Tool({ name: 'confirm', inputSchema: {} })
class ConfirmTool extends ToolContext {
  async execute() {
    const answer = await this.elicit('Proceed?', z.object({ confirmed: z.boolean() }));
    return { confirmed: answer.content?.confirmed ?? false };
  }
}

@Tool({ name: 'report', inputSchema: {}, execution: { taskSupport: 'optional' } })
class ReportTool extends ToolContext {
  async execute() {
    return { rows: 3 };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ConfirmTool, ReportTool] })
class DeskApp {}

const deskConfig = {
  info: { name: 'on-demand-desk', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
};

describe('Scope features loaded on demand', () => {
  afterEach(() => {
    for (const modulePath of ON_DEMAND_MODULES) jest.dontMock(modulePath);
  });

  it('creates a server without loading a feature its config does not use', async () => {
    await jest.isolateModulesAsync(async () => {
      for (const modulePath of ON_DEMAND_MODULES) {
        jest.doMock(modulePath, () => {
          throw new Error(`${modulePath} was loaded`);
        });
      }
      const common = await import('../../common');
      const { create: createIsolated } = await import('../../direct/create');
      class IsolatedPingTool extends common.ToolContext {
        async execute() {
          return { pong: true };
        }
      }
      common.Tool({ name: 'ping', inputSchema: {} })(IsolatedPingTool);

      const server = await createIsolated({ info: { name: 'on-demand', version: '1.0.0' }, tools: [IsolatedPingTool] });
      try {
        const { tools } = await server.listTools();
        expect(tools.map((tool) => tool.name)).toEqual(['ping']);
      } finally {
        await server.dispose();
      }
    });
  });

  it('loads a feature the config uses before create() resolves', async () => {
    const server = await create({
      info: { name: 'on-demand-jobs', version: '1.0.0' },
      tools: [PingTool],
      jobDefinitions: [CountJob],
    });
    try {
      const { tools } = await server.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['ping', 'execute_job', 'get_job_status']));
    } finally {
      await server.dispose();
    }
  });

  it('elicits through the client when elicitation is on', async () => {
    const client = await connect(
      { ...deskConfig, elicitation: { enabled: true } },
      { onElicitation: async () => ({ action: 'accept', content: { confirmed: true } }) },
    );
    try {
      const result = (await client.callTool('confirm', {})) as { structuredContent?: unknown };
      expect(result.structuredContent).toEqual({ confirmed: true });
    } finally {
      await client.close();
    }
  });

  it('runs a task-augmented call, since tasks are on by default', async () => {
    const instance = new FrontMcpInstance(frontMcpMetadataSchema.parse(deskConfig));
    await instance.ready;
    const scope = instance.getPrimaryScope() as Scope;
    const ctx = { authInfo: { sessionId: 'on-demand-task-session' } };
    try {
      const created = (await scope.runFlowForOutput('tools:call-tool', {
        request: { method: 'tools/call', params: { name: 'report', arguments: {}, task: { ttl: 60_000 } } },
        ctx,
      })) as unknown as { task: { taskId: string } };
      const taskStatus = async () =>
        (await scope.runFlowForOutput('tasks:get', {
          request: { method: 'tasks/get', params: { taskId: created.task.taskId } },
          ctx,
        })) as unknown as { taskId: string; status: string };
      for (let attempt = 0; attempt < 50 && (await taskStatus()).status === 'working'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(await taskStatus()).toMatchObject({ taskId: created.task.taskId, status: 'completed' });
    } finally {
      await instance.shutdown();
    }
  });
});
