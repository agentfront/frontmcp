/**
 * Features a server only needs when its config asks for them are loaded with `import()` (#827), so a browser
 * bundle of create() keeps them in chunks of their own: a server that doesn't use one never loads it, and one
 * that does has it before create() resolves.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  Agent,
  AgentContext,
  App,
  DynamicPlugin,
  frontMcpMetadataSchema,
  Job,
  JobContext,
  LogLevel,
  Plugin,
  ScopeEntry,
  Skill,
  SkillContext,
  Tool,
  ToolContext,
} from '../../common';
import { connect } from '../../direct/connect';
import { create } from '../../direct/create';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../scope.instance';

const ON_DEMAND_MODULES = [
  '../../agent/agent.instance',
  '../../agent/flows',
  '../../app/instances/app.esm.instance',
  '../../app/instances/app.remote.instance',
  '../../channel/channel-scope.helper',
  '../../elicitation/flows',
  '../../elicitation/send-elicitation-result.tool',
  '../../elicitation/store/elicitation-store.factory',
  '../../esm-loader/esm-entries',
  '../flows/http.ip-filter.flow',
  '../flows/http.request.flow',
  '../../ha',
  '../../health',
  '../http-scope.helper',
  '../../job/job-scope.helper',
  '../../mcp-registry/mcp-registry-scope.helper',
  '../../metrics',
  '../observability-scope.helper',
  '../../remote-mcp/remote-entries',
  '../../server/custom-routes.helper',
  '../../server/server.instance',
  '../../skill/flows/index',
  '../../skill/hooks/index',
  '../../skill/providers/memory-skill.provider',
  '../../skill/session/index',
  '../../skill/skill-md-parser',
  '../../tool/ui/ui-option-warnings',
  '../../tool/ui/ui-render',
  '../../tool/ui/ui-resource-template',
  '../../tool/ui/ui-resource.handler',
  '../../transport/bus',
  '../../transport/event-stores',
  '../../transport/ipc-server.transport',
  '../../transport/relay/relay-scope.helper',
  '../../transport/transport.registry',
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

@Tool({ name: 'lookup', inputSchema: {}, ui: { template: '<div id="lookup-widget"></div>', servingMode: 'static' } })
class LookupTool extends ToolContext {
  async execute() {
    return { source: 'crm' };
  }
}

@Agent({
  name: 'helper',
  inputSchema: {},
  llm: { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } },
})
class HelperAgent extends AgentContext {}

@Tool({ name: 'add_skill_at_runtime', inputSchema: {} })
class AddSkillAtRuntimeTool extends ToolContext {
  async execute() {
    const skills = this.get(ScopeEntry).skills;
    await skills.registerSkillContent({
      id: 'late-skill',
      name: 'late-skill',
      description: 'Registered at runtime',
      instructions: 'Do the late thing.',
      tools: [],
    });
    return { description: (await skills.loadSkill('late-skill'))?.skill.description };
  }
}

@Plugin({ name: 'runtime-skills', tools: [AddSkillAtRuntimeTool] })
class RuntimeSkillsPlugin extends DynamicPlugin<Record<string, never>> {}

@Plugin({ name: 'declared-runtime-skills', dynamicSkills: true, tools: [AddSkillAtRuntimeTool] })
class DeclaredRuntimeSkillsPlugin extends DynamicPlugin<Record<string, never>> {}

@Skill({ name: 'startup-skill', description: 'Present at startup', instructions: 'Do it.' })
class StartupSkill extends SkillContext {}

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

  it.each(['create', 'connect'] as const)(
    'serves %s() without loading a feature its config does not use, HTTP included',
    async (entry) => {
      await jest.isolateModulesAsync(async () => {
        for (const modulePath of ON_DEMAND_MODULES) {
          jest.doMock(modulePath, () => {
            throw new Error(`${modulePath} was loaded`);
          });
        }
        const common = await import('../../common');
        class IsolatedPingTool extends common.ToolContext {
          async execute() {
            return { pong: true };
          }
        }
        common.Tool({ name: 'ping', inputSchema: {} })(IsolatedPingTool);

        if (entry === 'create') {
          const { create: createIsolated } = await import('../../direct/create');
          const server = await createIsolated({
            info: { name: 'on-demand', version: '1.0.0' },
            tools: [IsolatedPingTool],
          });
          try {
            const { tools } = await server.listTools();
            expect(tools.map((tool) => tool.name)).toEqual(['ping']);
          } finally {
            await server.dispose();
          }
          return;
        }

        const { connect: connectIsolated } = await import('../../direct/connect');
        @common.App({ id: 'pinger', name: 'Pinger', tools: [IsolatedPingTool] })
        class PingerApp {}
        const client = await connectIsolated({
          info: { name: 'on-demand', version: '1.0.0' },
          apps: [PingerApp],
          logging: { level: common.LogLevel.Off },
        });
        try {
          const tools = (await client.listTools()) as Array<{ name: string }>;
          expect(tools.map((tool) => tool.name)).toEqual(['ping']);
        } finally {
          await client.close();
        }
      });
    },
  );

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

  it('lists and serves the widget of a tool with a UI', async () => {
    const server = await create({ info: { name: 'on-demand-ui', version: '1.0.0' }, tools: [LookupTool] });
    try {
      const { tools } = await server.listTools();
      expect(tools[0]._meta).toMatchObject({
        ui: { resourceUri: 'ui://widget/lookup.html' },
        'frontmcp/type': 'html',
        'frontmcp/cdn': expect.any(Object),
      });
      const { contents } = await server.readResource('ui://widget/lookup.html');
      expect(contents[0]).toMatchObject({
        mimeType: 'text/html;profile=mcp-app',
        text: expect.stringContaining('lookup-widget'),
      });
    } finally {
      await server.dispose();
    }
  });

  it('lists and calls an agent', async () => {
    const server = await create({ info: { name: 'on-demand-agent', version: '1.0.0' }, agents: [HelperAgent] });
    try {
      const { tools } = await server.listTools();
      expect(tools.map((tool) => tool.name)).toContain('invoke_helper');
      expect(JSON.stringify(await server.callTool('invoke_helper', {}))).toContain('done');
    } finally {
      await server.dispose();
    }
  });

  it('searches and loads a skill declared at startup', async () => {
    const client = await connect({ ...deskConfig, apps: [DeskApp], skills: [StartupSkill] });
    try {
      const { skills } = await client.searchSkills('startup');
      expect(skills.map((found) => found.name)).toContain('startup-skill');
      expect(JSON.stringify(await client.loadSkills(['startup-skill']))).toContain('Do it.');
    } finally {
      await client.close();
    }
  });

  it.each([
    ['without declaring it', RuntimeSkillsPlugin],
    ['with dynamicSkills', DeclaredRuntimeSkillsPlugin],
  ])('serves a skill a plugin registers at runtime, %s', async (_label, plugin) => {
    const server = await create({ info: { name: 'on-demand-runtime-skill', version: '1.0.0' }, plugins: [plugin] });
    try {
      const result = (await server.callTool('add_skill_at_runtime', {})) as { structuredContent?: unknown };
      expect(result.structuredContent).toEqual({ description: 'Registered at runtime' });
    } finally {
      await server.dispose();
    }
  });
});
