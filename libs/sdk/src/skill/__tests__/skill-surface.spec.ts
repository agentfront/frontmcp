import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Skill, SkillContext } from '../../common';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { composeCallerInstructions } from '../skill-instructions.helper';

/**
 * `availableWhen.surface` on a skill applies on every path that serves skills, as it does to tools,
 * resources and prompts: the MCP `skills/*` methods, the `skill://` resources and their completions,
 * the server instructions, and the skills HTTP endpoints (which count as the `'mcp'` surface).
 * A skill offered only to agents is absent from all of them and not found when named.
 */

@Skill({ name: 'public-guide', description: 'Public onboarding guide', instructions: 'Public guide steps.' })
class PublicGuideSkill extends SkillContext {}

@Skill({
  name: 'agent-guide',
  description: 'Agent onboarding guide',
  instructions: 'Agent guide steps.',
  availableWhen: { surface: ['agent'] },
})
class AgentGuideSkill extends SkillContext {}

@App({ id: 'guides', name: 'Guides', skills: [PublicGuideSkill, AgentGuideSkill] })
class GuidesApp {}

const serverConfig = {
  info: { name: 'skills-surface', version: '1.0.0' },
  apps: [GuidesApp],
  logging: { level: LogLevel.Off },
  skillsConfig: { enabled: true },
};

function textOf(result: ReadResourceResult): string {
  const [content] = result.contents;
  return content && 'text' in content ? content.text : '';
}

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('availableWhen.surface on skills', () => {
  describe('over MCP', () => {
    let client: DirectClient;

    beforeAll(async () => {
      client = await connect(serverConfig);
    });

    afterAll(async () => {
      await client.close();
    });

    it('leaves an agent-only skill out of skills/list and skills/search', async () => {
      const listed = await client.listSkills();
      const found = await client.searchSkills('onboarding guide');

      expect({
        listed: listed.skills.map((skill) => skill.id),
        total: listed.total,
        found: found.skills.map((skill) => skill.id),
      }).toEqual({ listed: ['public-guide'], total: 1, found: ['public-guide'] });
    });

    it('reports an agent-only skill as not found from skills/load', async () => {
      const { skills, summary } = await client.loadSkills(['agent-guide', 'public-guide']);

      expect(skills.map((skill) => skill.id)).toEqual(['public-guide']);
      expect(summary.combinedWarnings).toEqual(['Skill "agent-guide" not found']);
    });

    it('leaves an agent-only skill out of skill://index.json and does not serve its SKILL.md', async () => {
      const index = JSON.parse(textOf(await client.readResource('skill://index.json'))) as {
        skills: Array<{ name: string }>;
      };

      expect(index.skills.map((entry) => entry.name)).toEqual(['public-guide']);
      expect(await rejectionOf(client.readResource('skill://agent-guide/SKILL.md'))).toBeInstanceOf(Error);
      expect(textOf(await client.readResource('skill://public-guide/SKILL.md'))).toContain('Public guide steps.');
    });

    it('does not complete the path of an agent-only skill', async () => {
      const { completion } = await client.complete({
        ref: { type: 'ref/resource', uri: 'skill://{+skillPath}/SKILL.md' },
        argument: { name: 'skillPath', value: '' },
      });

      expect(completion.values).toEqual(['public-guide']);
    });
  });

  describe('in the server instructions', () => {
    it('lists no agent-only skill to an MCP client', async () => {
      const [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes();
      const instructions = await composeCallerInstructions(scope as Scope, { ctx: { authInfo: {} } });

      expect(instructions).toContain('public-guide');
      expect(instructions).not.toContain('agent-guide');
    });
  });

  describe('over the skills HTTP endpoints (the mcp surface)', () => {
    let server: TestFetchServer;

    async function get(path: string): Promise<{ status: number; body: string }> {
      const response = await server.handler(new Request(new URL(path, 'http://localhost')));
      return { status: response.status, body: await response.text() };
    }

    beforeAll(async () => {
      server = await createTestFetchServer(serverConfig);
    });

    it('answers GET /skills/{id} with 404 for an agent-only skill', async () => {
      const { status, body } = await get('/skills/agent-guide');

      expect(status).toBe(404);
      expect(body).not.toContain('Agent guide steps.');
    });

    it('leaves an agent-only skill out of /skills, /skills?query=, /llm.txt and /llm_full.txt', async () => {
      const bodies = await Promise.all(
        ['/skills', '/skills?query=onboarding', '/llm.txt', '/llm_full.txt'].map(
          async (path) => (await get(path)).body,
        ),
      );

      expect(bodies.filter((body) => body.includes('agent-guide') || body.includes('Agent guide steps.'))).toEqual([]);
      expect(bodies.every((body) => body.includes('public-guide') || body.includes('Public guide steps.'))).toBe(true);
    });
  });
});
