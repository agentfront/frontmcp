import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  App,
  LogLevel,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Skill,
  Tool,
  ToolContext,
  type EnabledSource,
  type FrontMcpConfigInput,
} from '../../common';
import { connect } from '../../direct/connect';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { computeSkillHash } from '../../skill/sync/skill-hash';
import { buildManifest } from '../build-manifest';
import { SERVER_MANIFEST_VERSION, serverManifestSchema } from '../server-manifest.schema';

const liveSwitch: EnabledSource = { get: () => true, subscribe: () => () => undefined };

@Tool({
  name: 'add',
  title: 'Add',
  description: 'Add two numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: { sum: z.number() },
  annotations: { readOnlyHint: true },
  aliases: ['plus'],
  tags: ['math'],
  _meta: { 'acme/team': 'calc' },
})
class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return { sum: input.a + input.b };
  }
}

@Tool({ name: 'vault', inputSchema: {}, visibility: 'hidden', enabled: false })
class VaultTool extends ToolContext {
  async execute() {
    return 'closed';
  }
}

@Tool({ name: 'beta', description: 'A tool behind a switch', inputSchema: {}, enabled: liveSwitch })
class BetaTool extends ToolContext {
  async execute() {
    return 'on';
  }
}

@Tool({
  name: 'deploy',
  description: 'Deploy in production only',
  inputSchema: {},
  availableWhen: { env: ['production'] },
})
class DeployTool extends ToolContext {
  async execute() {
    return 'deployed';
  }
}

@Resource({ name: 'readme', uri: 'docs://readme', description: 'The readme', mimeType: 'text/markdown' })
class ReadmeResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: '# Calc' }] };
  }
}

@ResourceTemplate({ name: 'result', uriTemplate: 'results://{id}', description: 'One result', mimeType: 'text/plain' })
class ResultTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'result' }] };
  }
}

@Prompt({ name: 'explain', description: 'Explain a sum', arguments: [{ name: 'sum', required: true }] })
class ExplainPrompt extends PromptContext {
  async execute() {
    return { messages: [] };
  }
}

@Skill({
  name: 'adding',
  description: 'Add numbers with the add tool',
  instructions: 'Call add with both numbers.',
  tools: [{ name: 'add', purpose: 'Add two numbers', required: true }],
  tags: ['math'],
})
class AddingSkill {}

@App({
  id: 'calc',
  name: 'Calc',
  description: 'Arithmetic',
  tools: [AddTool, VaultTool, BetaTool, DeployTool],
  resources: [ReadmeResource, ResultTemplate],
  prompts: [ExplainPrompt],
  skills: [AddingSkill],
})
class CalcApp {}

function config(extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'manifest-demo', version: '2.1.0' },
    apps: [CalcApp],
    instructions: 'Use the calc tools.',
    logging: { level: LogLevel.Off },
    ...extra,
  };
}

describe('buildManifest()', () => {
  it('lists every entry with its schemas, annotations and owning app', async () => {
    const manifest = await buildManifest(config());

    expect(manifest.manifestVersion).toBe(SERVER_MANIFEST_VERSION);
    expect(manifest.server).toEqual(expect.objectContaining({ name: 'manifest-demo', version: '2.1.0' }));
    expect(manifest.apps).toEqual([{ id: 'calc', name: 'Calc', description: 'Arithmetic' }]);
    expect(manifest.tools.find((tool) => tool.name === 'add')).toEqual({
      name: 'add',
      title: 'Add',
      description: 'Add two numbers',
      app: 'calc',
      owner: 'app:calc',
      inputSchema: expect.objectContaining({
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      }),
      outputSchema: expect.objectContaining({ type: 'object', properties: { sum: { type: 'number' } } }),
      annotations: { readOnlyHint: true },
      _meta: { 'acme/team': 'calc' },
      tags: ['math'],
      aliases: ['plus'],
      visibility: 'public',
    });
    expect(manifest.resources.find((resource) => resource.uri === 'docs://readme')).toEqual({
      uri: 'docs://readme',
      name: 'readme',
      description: 'The readme',
      mimeType: 'text/markdown',
      app: 'calc',
      owner: 'app:calc',
    });
    expect(manifest.resourceTemplates.find((template) => template.uriTemplate === 'results://{id}')).toEqual(
      expect.objectContaining({ name: 'result', app: 'calc', owner: 'app:calc', mimeType: 'text/plain' }),
    );
    expect(manifest.prompts).toEqual([
      {
        name: 'explain',
        description: 'Explain a sum',
        app: 'calc',
        owner: 'app:calc',
        arguments: [{ name: 'sum', required: true }],
      },
    ]);
  });

  it("lists the framework's own entries, such as the skill resources, without an app", async () => {
    const manifest = await buildManifest(config());

    expect(manifest.resources.find((resource) => resource.uri === 'skill://index.json')).toEqual(
      expect.objectContaining({ owner: 'scope:root', mimeType: 'application/json' }),
    );
    expect(manifest.resources.find((resource) => resource.uri === 'skill://index.json')).not.toHaveProperty('app');
  });

  it('records a switched-off, a live-switched and an environment-bound tool instead of leaving them out', async () => {
    const manifest = await buildManifest(config());
    const byName = new Map(manifest.tools.map((tool) => [tool.name, tool]));

    expect(byName.get('vault')).toEqual(expect.objectContaining({ enabled: false, visibility: 'hidden' }));
    expect(byName.get('beta')).toEqual(expect.objectContaining({ enabled: 'source', visibility: 'public' }));
    expect(byName.get('deploy')).toEqual(expect.objectContaining({ availableWhen: { env: ['production'] } }));
    expect(byName.get('add')).not.toHaveProperty('enabled');
  });

  it('gives each skill its path, tools and the hash of its loaded content', async () => {
    const manifest = await buildManifest(config());
    const instance = await FrontMcpInstance.createForCli(config());
    const loaded = await (instance.getPrimaryScope() as Scope).skills.findByName('adding')?.load();

    expect(manifest.skills).toEqual([
      {
        name: 'adding',
        path: 'adding',
        description: 'Add numbers with the add tool',
        app: 'calc',
        owner: 'app:calc',
        tags: ['math'],
        visibility: 'both',
        tools: [{ name: 'add', purpose: 'Add two numbers', required: true }],
        hash: loaded && computeSkillHash(loaded),
      },
    ]);
    expect(manifest.skills[0].hash).toMatch(/^[0-9a-f]{64}$/);
    await Promise.all((instance.getScopes() as Scope[]).map((scope) => scope.dispose()));
  });

  it('carries the initialize instructions and the resolved budget', async () => {
    expect((await buildManifest(config())).server.instructions).toContain('Use the calc tools.');
    expect((await buildManifest(config())).budget).toEqual({ instructions: 1024, toolDescription: 1024 });
    expect((await buildManifest(config({ instructionsBudget: { toolDescription: 80 } }))).budget).toEqual({
      instructions: 1024,
      toolDescription: 80,
    });
    expect(await buildManifest(config({ instructionsBudget: false }))).not.toHaveProperty('budget');
  });

  it('is plain JSON, sorted, valid against its schema and the same on every build', async () => {
    const first = await buildManifest(config());
    const second = await buildManifest(config());

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(serverManifestSchema.parse(first)).toEqual(first);
    const names = first.tools.map((tool) => tool.name);
    expect(names).toEqual([...names].sort());
  });

  it('shares the server a connect() client already serves', async () => {
    const shared = config();
    const client = await connect(shared);
    const manifest = await buildManifest(shared);

    expect(manifest.tools.map((tool) => tool.name)).toContain('add');
    await expect(client.callTool('add', { a: 1, b: 2 })).resolves.toBeDefined();
    await client.close();
  });
});
