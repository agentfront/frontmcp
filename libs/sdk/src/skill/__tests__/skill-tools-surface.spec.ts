import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Skill, SkillContext, Tool, ToolContext } from '../../common';
import { runOnSurface } from '../../context/call-surface';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';

/**
 * A skill names its tools, and loading it reports which of them the caller can use, with their
 * input schemas. A tool `availableWhen.surface` doesn't offer the caller (an agent-only tool, for an
 * MCP client) is one `tools/list` leaves out and `tools/call` answers as unknown, so loading a skill
 * must report it as missing too, without its schema: through `skills/load`, the `skills:load` flow,
 * `GET /skills/{id}` and `/llm_full.txt`.
 */

@Tool({ name: 'lookup_order', description: 'Look up an order', inputSchema: { orderId: z.string() } })
class LookupOrderTool extends ToolContext {
  async execute(_input: { orderId: string }) {
    return { ok: true };
  }
}

@Tool({
  name: 'reindex_orders',
  description: 'Rebuild the order index',
  inputSchema: { fullRebuild: z.boolean() },
  availableWhen: { surface: ['agent'] },
})
class ReindexOrdersTool extends ToolContext {
  async execute(_input: { fullRebuild: boolean }) {
    return { ok: true };
  }
}

@Skill({
  name: 'order-support',
  description: 'Handle order questions',
  instructions: 'Look the order up, then reindex if it is missing.',
  tools: [
    { name: 'lookup_order', purpose: 'Find the order' },
    { name: 'reindex_orders', purpose: 'Rebuild the index' },
  ],
})
class OrderSupportSkill extends SkillContext {}

@App({ id: 'orders', name: 'Orders', tools: [LookupOrderTool, ReindexOrdersTool], skills: [OrderSupportSkill] })
class OrdersApp {}

const serverConfig = {
  info: { name: 'skill-tools-surface', version: '1.0.0' },
  apps: [OrdersApp],
  logging: { level: LogLevel.Off },
  skillsConfig: { enabled: true },
};

/** The agent-only tool's schema, as it would appear in any rendering. */
const AGENT_ONLY_FIELD = 'fullRebuild';

describe('loading a skill reports the tools the caller can use', () => {
  describe('skills/load over MCP', () => {
    let client: DirectClient;

    beforeAll(async () => {
      client = await connect(serverConfig);
    });

    afterAll(async () => {
      await client.close();
    });

    it('reports an agent-only tool as missing, without its input schema', async () => {
      const { skills } = await client.loadSkills(['order-support']);
      const [skill] = skills;

      expect({
        tools: skill.tools.map((tool) => ({ name: tool.name, available: tool.available, schema: !!tool.inputSchema })),
        availableTools: skill.availableTools,
        missingTools: skill.missingTools,
        isComplete: skill.isComplete,
      }).toEqual({
        tools: [
          { name: 'lookup_order', available: true, schema: true },
          { name: 'reindex_orders', available: false, schema: false },
        ],
        availableTools: ['lookup_order'],
        missingTools: ['reindex_orders'],
        isComplete: false,
      });
      expect(skill.formattedContent).not.toContain(AGENT_ONLY_FIELD);
      expect(skill.formattedContent).toContain('orderId');
    });
  });

  describe('the skills:load flow', () => {
    let scope: Scope;

    beforeAll(async () => {
      const instance = await FrontMcpInstance.createForGraph(serverConfig);
      scope = instance.getPrimaryScope() as Scope;
    });

    async function loadOn(surface: 'mcp' | 'agent') {
      const output = (await runOnSurface(surface, () =>
        scope.runFlowForOutput('skills:load', {
          request: { method: 'skills/load', params: { skillIds: ['order-support'], policyMode: 'permissive' } },
          ctx: {},
        } as never),
      )) as { skills: Array<{ tools: Array<{ name: string; available: boolean; inputSchema?: unknown }> }> };
      return output.skills[0].tools.map((tool) => ({
        name: tool.name,
        available: tool.available,
        schema: !!tool.inputSchema,
      }));
    }

    it('reports an agent-only tool as missing to an MCP caller', async () => {
      expect(await loadOn('mcp')).toEqual([
        { name: 'lookup_order', available: true, schema: true },
        { name: 'reindex_orders', available: false, schema: false },
      ]);
    });

    it('reports it as available to an agent', async () => {
      expect(await loadOn('agent')).toEqual([
        { name: 'lookup_order', available: true, schema: true },
        { name: 'reindex_orders', available: true, schema: true },
      ]);
    });
  });

  describe('the skills HTTP endpoints (the mcp surface)', () => {
    let server: TestFetchServer;

    async function get(path: string): Promise<{ status: number; body: string }> {
      const response = await server.handler(new Request(new URL(path, 'http://localhost')));
      return { status: response.status, body: await response.text() };
    }

    beforeAll(async () => {
      server = await createTestFetchServer(serverConfig);
    });

    it('reports an agent-only tool as missing from GET /skills/{id}, without its schema', async () => {
      const { status, body } = await get('/skills/order-support');
      const json = JSON.parse(body) as {
        skill: { tools: Array<{ name: string; available: boolean }> };
        availableTools: string[];
        missingTools: string[];
        isComplete: boolean;
      };

      expect(status).toBe(200);
      expect({
        tools: json.skill.tools,
        availableTools: json.availableTools,
        missingTools: json.missingTools,
        isComplete: json.isComplete,
      }).toEqual({
        tools: [
          { name: 'lookup_order', purpose: 'Find the order', available: true },
          { name: 'reindex_orders', purpose: 'Rebuild the index', available: false },
        ],
        availableTools: ['lookup_order'],
        missingTools: ['reindex_orders'],
        isComplete: false,
      });
      expect(body).not.toContain(AGENT_ONLY_FIELD);
    });

    it('leaves the agent-only tool schema out of /llm_full.txt', async () => {
      const { status, body } = await get('/llm_full.txt');

      expect(status).toBe(200);
      expect(body).toContain('orderId');
      expect(body).not.toContain(AGENT_ONLY_FIELD);
    });
  });
});
