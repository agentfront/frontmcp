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

/**
 * One availability rule on every skill surface: a skill `availableWhen` doesn't offer the caller,
 * for the call's `surface` (agent-guide) or for a process-wide axis such as `runtime` (deno-guide),
 * is left out of every listing, the `skill://<path>/SKILL.md` entry of `resources/list` included,
 * and not found when named.
 */
@Skill({
  name: 'deno-guide',
  description: 'Deno onboarding guide',
  instructions: 'Deno guide steps.',
  availableWhen: { runtime: ['deno'] },
})
class DenoGuideSkill extends SkillContext {}

@App({ id: 'all-guides', name: 'All guides', skills: [PublicGuideSkill, AgentGuideSkill, DenoGuideSkill] })
class AllGuidesApp {}

const availabilityConfig = {
  ...serverConfig,
  info: { name: 'skills-availability', version: '1.0.0' },
  apps: [AllGuidesApp],
};

const EXCLUDED = ['agent-guide', 'deno-guide'];

function namesAnExcludedSkill(text: string): boolean {
  return EXCLUDED.some((name) => text.includes(name)) || /(Agent|Deno) guide steps\./.test(text);
}

describe('one availability rule on every skill surface (surface and process-wide axes)', () => {
  describe('over MCP', () => {
    let client: DirectClient;

    beforeAll(async () => {
      client = await connect(availabilityConfig);
    });

    afterAll(async () => {
      await client.close();
    });

    it('lists only the offered skill as a skill://<path>/SKILL.md resource in resources/list', async () => {
      const { resources } = await client.listResources();

      expect(resources.map((resource) => resource.uri).filter((uri) => uri.endsWith('/SKILL.md'))).toEqual([
        'skill://public-guide/SKILL.md',
      ]);
    });

    it('lists and finds only the offered skill in skills/list and skills/search', async () => {
      const listed = await client.listSkills();
      const found = await client.searchSkills('onboarding guide');

      expect({
        listed: listed.skills.map((skill) => skill.id),
        total: listed.total,
        found: found.skills.map((skill) => skill.id),
      }).toEqual({ listed: ['public-guide'], total: 1, found: ['public-guide'] });
    });

    it('finds no excluded skill by skills/load, skill://index.json, SKILL.md or path completion', async () => {
      const { skills } = await client.loadSkills([...EXCLUDED, 'public-guide']);
      const index = JSON.parse(textOf(await client.readResource('skill://index.json'))) as {
        skills: Array<{ name: string }>;
      };
      const { completion } = await client.complete({
        ref: { type: 'ref/resource', uri: 'skill://{+skillPath}/SKILL.md' },
        argument: { name: 'skillPath', value: '' },
      });
      const reads = await Promise.all(
        EXCLUDED.map(async (name) => rejectionOf(client.readResource(`skill://${name}/SKILL.md`))),
      );

      expect({
        loaded: skills.map((skill) => skill.id),
        indexed: index.skills.map((entry) => entry.name),
        completed: completion.values,
        readsRefused: reads.every((error) => error instanceof Error),
      }).toEqual({
        loaded: ['public-guide'],
        indexed: ['public-guide'],
        completed: ['public-guide'],
        readsRefused: true,
      });
    });
  });

  it('names no excluded skill in the server instructions', async () => {
    const [scope] = (await FrontMcpInstance.createForGraph(availabilityConfig)).getScopes();
    const instructions = await composeCallerInstructions(scope as Scope, { ctx: { authInfo: {} } });

    expect(instructions).toContain('public-guide');
    expect(namesAnExcludedSkill(instructions)).toBe(false);
  });

  it('publishes no excluded skill on the skills HTTP endpoints', async () => {
    const server = await createTestFetchServer(availabilityConfig);
    const get = async (path: string) => {
      const response = await server.handler(new Request(new URL(path, 'http://localhost')));
      return { path, status: response.status, body: await response.text() };
    };

    const byId = await Promise.all(EXCLUDED.map((name) => get(`/skills/${name}`)));
    const listings = await Promise.all(['/skills', '/skills?query=onboarding', '/llm.txt', '/llm_full.txt'].map(get));

    expect(byId.map(({ status }) => status)).toEqual([404, 404]);
    expect(listings.filter(({ body }) => namesAnExcludedSkill(body)).map(({ path }) => path)).toEqual([]);
    expect(listings.every(({ body }) => body.includes('public-guide') || body.includes('Public guide steps.'))).toBe(
      true,
    );
  });
});
