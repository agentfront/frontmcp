/**
 * The agents and skills of an `App.esm()` package, through a real scope with the package load mocked at the
 * `EsmModuleLoader` boundary: they are served as a local app's are, and a new version replaces them.
 */
import 'reflect-metadata';

import { Agent, AgentContext, App, Skill, skill } from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { normalizeEsmExport, type FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import { EsmModuleLoader, type EsmLoadResult } from '../../esm-loader/esm-module-loader';
import { VersionPoller } from '../../esm-loader/version-poller';
import { VersionResolver } from '../../esm-loader/version-resolver';
import { NotificationService } from '../../notification/notification.service';
import type { Scope } from '../../scope/scope.instance';

const GREETING = Symbol('GREETING');

/** An LLM that answers at once; the agents below override execute() and never call it. */
const answeringAdapter = { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) };

function helperAgent(name: string, answer: (agent: AgentContext) => Promise<string> | string) {
  @Agent({ name, inputSchema: {}, llm: { adapter: answeringAdapter } })
  class HelperAgent extends AgentContext {
    override async execute() {
      return answer(this);
    }
  }
  return HelperAgent;
}

@Skill({ name: 'review', description: 'Review a change', instructions: 'Read it, then echo it.', tools: ['echo'] })
class ReviewSkill {}

const triageSkill = skill({ name: 'triage', description: 'Triage an issue', instructions: 'Label it.' });

const echoTool = { name: 'echo', execute: async (input: Record<string, unknown>) => JSON.stringify(input) };

function loaded(manifest: Partial<FrontMcpPackageManifest>, version = '1.0.0'): EsmLoadResult {
  return {
    manifest: { name: '@acme/tools', version, ...manifest },
    resolvedVersion: version,
    source: 'network',
    loadedAt: Date.now(),
    rawModule: {},
  };
}

const scopeOf = (server: DirectMcpServer) => (server as unknown as { scope: Scope }).scope;
const textOf = (result: { content: unknown; structuredContent?: unknown }) =>
  (result.structuredContent as { value?: string } | undefined)?.value ??
  (result.content as Array<{ text: string }>)[0]?.text;
const skillUris = async (server: DirectMcpServer) =>
  (await server.listResources()).resources.map((resource) => resource.uri).filter((uri) => uri.startsWith('skill://'));

describe('App.esm() skills and agents', () => {
  let server: DirectMcpServer | undefined;
  let load: jest.SpyInstance;

  beforeEach(() => {
    load = jest.spyOn(EsmModuleLoader.prototype, 'load');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose().catch(() => undefined);
    server = undefined;
  });

  async function createGateway(options: Parameters<typeof App.esm>[1] = {}): Promise<DirectMcpServer> {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', ...options })],
    });
    return server;
  }

  it('serves the package skills, naming its tools as the app serves them', async () => {
    const plainSkill = {
      name: 'summarize',
      description: 'Summarize a thread',
      instructions: 'Echo the summary.',
      tools: [{ name: 'echo', purpose: 'Send the summary' }, 'other_tool'],
    };
    load.mockResolvedValue(loaded({ tools: [echoTool], skills: [ReviewSkill, triageSkill, plainSkill] }));
    const srv = await createGateway();

    expect((await skillUris(srv)).sort()).toEqual([
      'skill://index.json',
      'skill://review/SKILL.md',
      'skill://summarize/SKILL.md',
      'skill://triage/SKILL.md',
    ]);
    const skills = scopeOf(srv).skills;
    expect(skills.findByName('review')?.getToolNames()).toEqual(['acme:echo']);
    expect(skills.findByName('summarize')?.getToolRefs()).toEqual([
      { name: 'acme:echo', purpose: 'Send the summary', required: false },
      { name: 'other_tool', required: false },
    ]);
    const read = await srv.readResource('skill://review/SKILL.md');
    expect(JSON.stringify(read.contents)).toContain('Read it, then echo it.');
  });

  it('calls a package agent, which resolves the package providers', async () => {
    const HelperAgent = helperAgent('helper', (agent) => `${agent.get<string>(GREETING)} from the agent`);
    load.mockResolvedValue(loaded({ providers: [{ provide: GREETING, useValue: 'hello' }], agents: [HelperAgent] }));
    const srv = await createGateway();

    expect((await srv.listTools()).tools.map((tool) => tool.name)).toContain('invoke_helper');
    expect(textOf(await srv.callTool('invoke_helper', {}))).toBe('hello from the agent');
    expect(scopeOf(srv).agents.findByName('helper')).toBeDefined();
  });

  it('lets the filter through by the skill and agent names', async () => {
    load.mockResolvedValue(
      loaded({
        skills: [ReviewSkill, triageSkill],
        agents: [helperAgent('helper', () => 'helped'), helperAgent('planner', () => 'planned')],
      }),
    );
    const srv = await createGateway({ filter: { exclude: { skills: ['triage'], agents: ['plan*'] } } });

    expect(
      scopeOf(srv)
        .skills.getSkills(true)
        .map((entry) => entry.name),
    ).toEqual(['review']);
    const toolNames = (await srv.listTools()).tools.map((tool) => tool.name);
    expect(toolNames).toContain('invoke_helper');
    expect(toolNames).not.toContain('invoke_planner');
  });

  it('serves the skills and agents of a default-exported @App class', async () => {
    @App({ name: 'support', skills: [ReviewSkill], agents: [helperAgent('helper', () => 'helped')] })
    class SupportApp {}
    load.mockResolvedValue(loaded(normalizeEsmExport({ default: SupportApp })));
    const srv = await createGateway();

    expect(await skillUris(srv)).toContain('skill://review/SKILL.md');
    expect(textOf(await srv.callTool('invoke_helper', {}))).toBe('helped');
  });

  it('stops the server when the package exports a skill that is not one', async () => {
    load.mockResolvedValue(loaded({ skills: [{ name: 'Not Kebab', description: 'x', instructions: 'y' }] }));

    await expect(createGateway()).rejects.toThrow(/kebab-case/);
  });

  it('stops the server when the package exports an agent that is not one', async () => {
    load.mockResolvedValue(loaded({ agents: [{ name: 'helper' }] }));

    await expect(createGateway()).rejects.toThrow(/agent/);
  });
});

describe('App.esm() skills and agents across versions', () => {
  let server: DirectMcpServer | undefined;
  let poller: { poll(): Promise<void> } | undefined;
  let load: jest.SpyInstance;
  let broadcast: jest.SpyInstance;

  beforeEach(() => {
    load = jest.spyOn(EsmModuleLoader.prototype, 'load');
    broadcast = jest.spyOn(NotificationService.prototype, 'broadcastNotification');
    jest.spyOn(VersionPoller.prototype, 'start').mockImplementation(function (this: VersionPoller) {
      poller = this as unknown as { poll(): Promise<void> };
    });
    jest
      .spyOn(VersionResolver.prototype, 'resolve')
      .mockResolvedValue({ resolvedVersion: '1.1.0', availableVersions: ['1.0.0', '1.1.0'] });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose().catch(() => undefined);
    server = undefined;
    poller = undefined;
  });

  async function startPolling(first: EsmLoadResult): Promise<{ srv: DirectMcpServer; poll: () => Promise<void> }> {
    load.mockResolvedValueOnce(first);
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', autoUpdate: { enabled: true } })],
    });
    const started = poller;
    if (!started) throw new Error('the version poller did not start');
    return { srv: server, poll: () => started.poll() };
  }

  const listChanged = () =>
    broadcast.mock.calls.map(([method]) => method as string).filter((m) => m.endsWith('/list_changed'));

  it("replaces the old version's agents and skills, announcing each changed list once", async () => {
    const { srv, poll } = await startPolling(
      loaded({
        agents: [helperAgent('helper', () => 'v1'), helperAgent('planner', () => 'planned')],
        skills: [ReviewSkill],
      }),
    );
    load.mockResolvedValueOnce(loaded({ agents: [helperAgent('helper', () => 'v2')], skills: [triageSkill] }, '1.1.0'));
    broadcast.mockClear();

    await poll();

    expect(textOf(await srv.callTool('invoke_helper', {}))).toBe('v2');
    const toolNames = (await srv.listTools()).tools.map((tool) => tool.name);
    expect(toolNames).not.toContain('invoke_planner');
    expect(scopeOf(srv).agents.findByName('planner')).toBeUndefined();
    expect((await skillUris(srv)).sort()).toEqual(['skill://index.json', 'skill://triage/SKILL.md']);
    expect(scopeOf(srv).skills.findByName('review')).toBeUndefined();
    expect(listChanged().sort()).toEqual([
      'notifications/resources/list_changed',
      'notifications/skills/list_changed',
      'notifications/tools/list_changed',
    ]);
  });

  it('serves the first agent and skill that a new version brings to a server that had none', async () => {
    const { srv, poll } = await startPolling(loaded({ tools: [echoTool] }));
    expect(await skillUris(srv)).toEqual([]);
    load.mockResolvedValueOnce(
      loaded({ tools: [echoTool], agents: [helperAgent('helper', () => 'new')], skills: [ReviewSkill] }, '1.1.0'),
    );

    await poll();

    expect(textOf(await srv.callTool('invoke_helper', {}))).toBe('new');
    expect(await skillUris(srv)).toContain('skill://review/SKILL.md');
    expect(scopeOf(srv).skills.findByName('review')?.getToolNames()).toEqual(['acme:echo']);
  });

  it('keeps the loaded version when the new one exports a skill that is not one', async () => {
    const { srv, poll } = await startPolling(loaded({ agents: [helperAgent('helper', () => 'v1')] }));
    load.mockResolvedValueOnce(
      loaded({ agents: [helperAgent('helper', () => 'v2')], skills: [{ name: 'Not Kebab' }] }, '1.1.0'),
    );

    await poll();

    expect(textOf(await srv.callTool('invoke_helper', {}))).toBe('v1');
  });

  it('lets an agent run that started on the old version finish on it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { srv, poll } = await startPolling(
      loaded({
        agents: [
          helperAgent('helper', async () => {
            started();
            await gate;
            return 'v1';
          }),
        ],
      }),
    );
    load.mockResolvedValueOnce(loaded({ agents: [helperAgent('helper', () => 'v2')] }, '1.1.0'));

    const inFlight = srv.callTool('invoke_helper', {});
    await running;
    await poll();
    release();

    expect(textOf(await inFlight)).toBe('v1');
    expect(textOf(await srv.callTool('invoke_helper', {}))).toBe('v2');
  });
});
