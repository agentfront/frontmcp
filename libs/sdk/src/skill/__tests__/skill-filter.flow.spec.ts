import 'reflect-metadata';

import { Client, InMemoryTransport, type ReadResourceResult } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  Skill,
  SkillContext,
  type FlowCtxOf,
  type FrontMcpConfigInput,
  type ServerResponse,
} from '../../common';
import { DynamicPlugin } from '../../common/dynamic/dynamic.plugin';
import { FrontMcpContextStorage } from '../../context';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { LocalTransportAdapter, type SupportedTransport } from '../../transport/adapters/transport.local.adapter';

const FilterSkillsHook = FlowHooksOf('skills:filter');

@Plugin({ name: 'restricted-skills' })
class RestrictedSkillsPlugin {
  @FilterSkillsHook.Did('filterSkills')
  hideRestricted(ctx: FlowCtxOf<'skills:filter'>) {
    ctx.state.set(
      'skills',
      ctx.state.required.skills.filter((skill) => !skill.metadata.tags?.includes('restricted')),
    );
  }
}

@Skill({ name: 'public-guide', description: 'Public onboarding guide', instructions: 'Public guide steps.' })
class PublicGuideSkill extends SkillContext {}

@Skill({
  name: 'restricted-guide',
  description: 'Restricted onboarding guide',
  instructions: 'Restricted guide steps.',
  tags: ['restricted'],
})
class RestrictedGuideSkill extends SkillContext {}

@App({
  id: 'guides',
  name: 'Guides',
  plugins: [RestrictedSkillsPlugin],
  skills: [PublicGuideSkill, RestrictedGuideSkill],
})
class GuidesApp {}

const serverConfig = {
  info: { name: 'skills-filter-flow', version: '1.0.0' },
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

const callersSeen: Array<{ sessionId?: string; authInfo?: unknown }> = [];

@Plugin({ name: 'skill-filter-caller-recorder' })
class CallerRecorderPlugin extends DynamicPlugin<Record<string, never>> {
  @FilterSkillsHook.Will('filterSkills')
  recordCaller() {
    const context = this.get(FrontMcpContextStorage).getStore();
    callersSeen.push({ sessionId: context?.sessionId, authInfo: context?.authInfo });
  }
}

@App({ id: 'recorded-guides', name: 'Recorded Guides', plugins: [CallerRecorderPlugin], skills: [PublicGuideSkill] })
class RecordedGuidesApp {}

let serverSideTransport: InMemoryTransport | undefined;

// The Streamable HTTP / SSE adapter's MCP server, reached over an in-memory transport instead of a socket.
class InMemoryLocalAdapter extends LocalTransportAdapter<SupportedTransport> {
  createTransport(): SupportedTransport {
    if (!serverSideTransport) throw new Error('no server-side transport');
    return serverSideTransport as unknown as SupportedTransport;
  }

  async initialize(): Promise<void> {
    throw new Error('not used over the in-memory transport');
  }

  async sendElicitRequest(): Promise<never> {
    throw new Error('not used over the in-memory transport');
  }

  async handleRequest(): Promise<void> {
    throw new Error('not used over the in-memory transport');
  }
}

async function scopeOf(config: FrontMcpConfigInput): Promise<Scope> {
  const instance = await FrontMcpInstance.createForGraph(config);
  const [scope] = instance.getScopes();
  if (!scope) throw new Error('the config produced no scope');
  return scope as Scope;
}

let adapterSessions = 0;

async function initializeInstructions(scope: Scope): Promise<string | undefined> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  serverSideTransport = serverTransport;
  const sessionId = `local-adapter-${++adapterSessions}`;
  const adapter = new InMemoryLocalAdapter(
    scope,
    { type: 'streamable-http', token: 'token', tokenHash: 'token-hash', sessionId },
    () => undefined,
    {} as ServerResponse,
  );
  await adapter.ready;
  const client = new Client({ name: 'spec-client', version: '1.0.0' });
  await client.connect(clientTransport);
  const instructions = client.getInstructions();
  await client.close();
  return instructions;
}

describe('skills:filter flow', () => {
  describe('caller context over the in-memory transport', () => {
    let client: DirectClient;

    beforeAll(async () => {
      client = await connect(
        {
          info: { name: 'skills-filter-caller', version: '1.0.0' },
          apps: [RecordedGuidesApp],
          logging: { level: LogLevel.Off },
        },
        { session: { id: 'session-alice', user: { sub: 'alice' } } },
      );
    });

    afterAll(async () => {
      await client.close();
    });

    beforeEach(() => {
      callersSeen.length = 0;
    });

    const expectCallerSeen = () => {
      expect(callersSeen.length).toBeGreaterThan(0);
      for (const caller of callersSeen) {
        expect(caller).toMatchObject({ sessionId: 'session-alice', authInfo: { user: { sub: 'alice' } } });
      }
    };

    it('runs for skills/list with the caller session and auth info', async () => {
      await client.listSkills();

      expectCallerSeen();
    });

    it('runs for skills/search with the caller session and auth info', async () => {
      await client.searchSkills('onboarding guide');

      expectCallerSeen();
    });

    it('runs for skills/load with the caller session and auth info', async () => {
      await client.loadSkills(['public-guide']);

      expectCallerSeen();
    });

    it('runs for skill://index.json with the caller session and auth info', async () => {
      await client.readResource('skill://index.json');

      expectCallerSeen();
    });
  });

  describe('over MCP', () => {
    let client: DirectClient;

    beforeAll(async () => {
      client = await connect(serverConfig);
    });

    afterAll(async () => {
      await client.close();
    });

    it('leaves a skill the flow drops out of skills/search', async () => {
      const { skills } = await client.searchSkills('onboarding guide');

      expect(skills.map((skill) => skill.id)).toEqual(['public-guide']);
    });

    it('leaves a skill the flow drops out of skills/list', async () => {
      const { skills, total } = await client.listSkills();

      expect(skills.map((skill) => skill.id)).toEqual(['public-guide']);
      expect(total).toBe(1);
    });

    it('reports a skill the flow drops as not found from skills/load', async () => {
      const { skills, summary } = await client.loadSkills(['restricted-guide', 'public-guide']);

      expect(skills.map((skill) => skill.id)).toEqual(['public-guide']);
      expect(summary.combinedWarnings).toEqual(['Skill "restricted-guide" not found']);
    });

    it('leaves a skill the flow drops out of skill://index.json', async () => {
      const index = JSON.parse(textOf(await client.readResource('skill://index.json'))) as {
        skills: Array<{ name: string }>;
      };

      expect(index.skills.map((entry) => entry.name)).toContain('public-guide');
      expect(index.skills.map((entry) => entry.name)).not.toContain('restricted-guide');
    });

    it('does not serve the SKILL.md of a skill the flow drops', async () => {
      expect(await rejectionOf(client.readResource('skill://restricted-guide/SKILL.md'))).toBeInstanceOf(Error);
    });

    it('serves the SKILL.md of a skill the flow keeps', async () => {
      expect(textOf(await client.readResource('skill://public-guide/SKILL.md'))).toContain('Public guide steps.');
    });

    it('does not complete the path of a skill the flow drops', async () => {
      const { completion } = await client.complete({
        ref: { type: 'ref/resource', uri: 'skill://{+skillPath}/{+filePath}' },
        argument: { name: 'skillPath', value: '' },
      });

      expect(completion.values).toEqual(['public-guide']);
    });
  });

  describe('over HTTP', () => {
    let server: TestFetchServer;

    async function get(path: string): Promise<{ status: number; body: string }> {
      const response = await server.handler(new Request(new URL(path, 'http://localhost')));
      return { status: response.status, body: await response.text() };
    }

    beforeAll(async () => {
      server = await createTestFetchServer(serverConfig);
    });

    it('answers GET /skills/{id} with 404 for a skill the flow drops', async () => {
      const { status, body } = await get('/skills/restricted-guide');

      expect(status).toBe(404);
      expect(body).not.toContain('Restricted guide steps.');
    });

    it('leaves a skill the flow drops out of GET /skills and GET /skills?query=', async () => {
      expect((await get('/skills')).body).not.toContain('restricted-guide');
      expect((await get('/skills?query=onboarding')).body).not.toContain('restricted-guide');
      expect((await get('/skills?query=onboarding')).body).toContain('public-guide');
    });

    it('leaves a skill the flow drops out of /llm.txt and /llm_full.txt', async () => {
      const compact = await get('/llm.txt');
      const full = await get('/llm_full.txt');

      expect(compact.body).toContain('public-guide');
      expect(compact.body).not.toContain('restricted-guide');
      expect(full.body).toContain('Public guide steps.');
      expect(full.body).not.toContain('Restricted guide steps.');
    });
  });

  describe('in the initialize instructions (#603)', () => {
    it('leaves a skill the flow drops out of the skill catalog, and keeps the rest', async () => {
      const instructions = await initializeInstructions(await scopeOf(serverConfig));

      expect(instructions).toContain('**public-guide**: Public onboarding guide');
      expect(instructions).not.toContain('restricted-guide');
    });

    it('leaves a skill the flow drops out of the SEP-2640 skill:// hints', async () => {
      const scope = await scopeOf({ ...serverConfig, skillsConfig: { enabled: true, sep2640InInstructions: true } });
      const instructions = await initializeInstructions(scope);

      expect(instructions).toContain('skill://public-guide/SKILL.md');
      expect(instructions).not.toContain('skill://restricted-guide/SKILL.md');
    });

    it('filters for each initialize, not once when the transport is built', async () => {
      const scope = await scopeOf({
        info: { name: 'skills-filter-instructions-caller', version: '1.0.0' },
        apps: [RecordedGuidesApp],
        logging: { level: LogLevel.Off },
      });
      callersSeen.length = 0;

      await initializeInstructions(scope);
      await initializeInstructions(scope);

      expect(callersSeen).toHaveLength(2);
    });

    it('keeps the catalog unchanged when nothing filters', async () => {
      const scope = await scopeOf({
        info: { name: 'skills-unfiltered-instructions', version: '1.0.0' },
        apps: [RecordedGuidesApp],
        logging: { level: LogLevel.Off },
        instructions: 'Guides server.',
      });

      expect(await initializeInstructions(scope)).toBe(
        [
          'Guides server.',
          "Available skills (read the `skill://index.json` resource for each skill's `SKILL.md` URI):\n\n- **public-guide**: Public onboarding guide",
        ].join('\n\n---\n\n'),
      );
    });

    it('never names a skill the flow drops in the 2026-07-28 server/discover instructions', async () => {
      const server = await createTestFetchServer({ ...serverConfig, instructions: 'Guides server.' });
      const { message } = await rpc20260728(server.handler, 'server/discover');

      expect(JSON.stringify(message.result)).not.toContain('restricted-guide');
      expect(message.result?.['instructions']).toBe('Guides server.');
    });
  });
});
