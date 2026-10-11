/**
 * Features a server only needs when its config asks for them are loaded with `import()` (#827), so a browser
 * bundle of create() keeps them in chunks of their own: a server that doesn't use one never loads it, and one
 * that does has it before create() resolves.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { Job, JobContext, Tool, ToolContext } from '../../common';
import { create } from '../../direct/create';

const ON_DEMAND_MODULES = [
  '../../channel/channel-scope.helper',
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
});
