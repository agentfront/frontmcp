/**
 * The feature-flag gates, exercised through the real MCP and HTTP flows of an in-process server
 * rather than by calling the hook methods with a fake flow state (GHSA-gf7p-j3hr-h5h4).
 *
 * The plugin is installed on the app, the way `@App({ plugins: [FeatureFlagPlugin.init(...)] })`
 * is documented, so its hooks only reach an entry when the SDK resolves the entry to that app.
 * Every capability kind has an enabled and a disabled entry: the disabled one must be absent from
 * every listing AND refused when named directly; the enabled one must keep working.
 */
import 'reflect-metadata';

import {
  Adapter,
  App,
  composeCallerInstructions,
  connect,
  createWebFetchHandler,
  FrontMcpInstance,
  LogLevel,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Skill,
  SkillContext,
  Tool,
  ToolContext,
  type AdapterInterface,
  type DirectClient,
  type FrontMcpAdapterResponse,
  type FrontMcpConfigInput,
  type GetPromptResult,
  type ReadResourceResult,
  type ResourceCompletionResult,
} from '@frontmcp/sdk';

import FeatureFlagPlugin from '../feature-flag.plugin';

const FLAGS = { 'flag-on': true, 'flag-off': false };

// The Scope shape `createWebFetchHandler` expects (not re-exported from the SDK barrel)
type WebFetchScope = Parameters<typeof createWebFetchHandler>[0];

function textOf(result: ReadResourceResult): string {
  const [content] = result.contents;
  return content && 'text' in content ? content.text : '';
}

function textResource(uri: string): ReadResourceResult {
  return { contents: [{ uri, text: `content of ${uri}` }] };
}

function textPrompt(text: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

@Tool({ name: 'enabled_tool', inputSchema: {}, featureFlag: 'flag-on' })
class EnabledTool extends ToolContext {
  async execute() {
    return { ran: 'enabled_tool' };
  }
}

@Tool({ name: 'disabled_tool', inputSchema: {}, featureFlag: 'flag-off' })
class DisabledTool extends ToolContext {
  async execute() {
    return { ran: 'disabled_tool' };
  }
}

@Tool({ name: 'enabled_adapter_tool', inputSchema: {}, featureFlag: 'flag-on' })
class EnabledAdapterTool extends ToolContext {
  async execute() {
    return { ran: 'enabled_adapter_tool' };
  }
}

@Tool({ name: 'disabled_adapter_tool', inputSchema: {}, featureFlag: 'flag-off' })
class DisabledAdapterTool extends ToolContext {
  async execute() {
    return { ran: 'disabled_adapter_tool' };
  }
}

@Adapter({ name: 'flagged-api' })
class FlaggedApiAdapter implements AdapterInterface {
  options = { name: 'flagged-api' };

  fetch(): FrontMcpAdapterResponse {
    return { tools: [EnabledAdapterTool, DisabledAdapterTool] };
  }
}

@Resource({ name: 'enabled-resource', uri: 'flags://enabled', featureFlag: 'flag-on' })
class EnabledResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Resource({ name: 'disabled-resource', uri: 'flags://disabled', featureFlag: 'flag-off' })
class DisabledResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@ResourceTemplate({
  name: 'enabled-template',
  uriTemplate: 'flags://enabled-report/{reportId}',
  featureFlag: 'flag-on',
})
class EnabledTemplate extends ResourceContext<{ reportId: string }> {
  async reportIdCompleter(): Promise<ResourceCompletionResult> {
    return { values: ['enabled-report-1'] };
  }

  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@ResourceTemplate({
  name: 'disabled-template',
  uriTemplate: 'flags://disabled-report/{reportId}',
  featureFlag: 'flag-off',
})
class DisabledTemplate extends ResourceContext<{ reportId: string }> {
  async reportIdCompleter(): Promise<ResourceCompletionResult> {
    return { values: ['disabled-report-1'] };
  }

  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Prompt({ name: 'enabled-prompt', arguments: [{ name: 'topic' }], featureFlag: 'flag-on' })
class EnabledPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt('enabled prompt');
  }
}

@Prompt({ name: 'disabled-prompt', arguments: [{ name: 'topic' }], featureFlag: 'flag-off' })
class DisabledPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt('disabled prompt');
  }
}

@Skill({
  name: 'enabled-skill',
  description: 'Enabled flagged workflow',
  instructions: 'Enabled flagged workflow steps.',
  resources: { references: 'fixtures/skill-references' },
  featureFlag: 'flag-on',
})
class EnabledSkill extends SkillContext {}

@Skill({
  name: 'disabled-skill',
  description: 'Disabled flagged workflow',
  instructions: 'Disabled flagged workflow steps.',
  resources: { references: 'fixtures/skill-references' },
  featureFlag: 'flag-off',
})
class DisabledSkill extends SkillContext {}

@App({
  id: 'flagged',
  name: 'Flagged',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: FLAGS })],
  adapters: [FlaggedApiAdapter],
  tools: [EnabledTool, DisabledTool],
  resources: [EnabledResource, DisabledResource, EnabledTemplate, DisabledTemplate],
  prompts: [EnabledPrompt, DisabledPrompt],
  skills: [EnabledSkill, DisabledSkill],
})
class FlaggedApp {}

const serverConfig: FrontMcpConfigInput = {
  info: { name: 'feature-flag-flows', version: '1.0.0' },
  apps: [FlaggedApp],
  logging: { level: LogLevel.Off },
  skillsConfig: { enabled: true },
};

function errorMessageOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe('FeatureFlagPlugin through real flows (GHSA-gf7p-j3hr-h5h4)', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect(serverConfig);
  });

  afterAll(async () => {
    await client.close();
  });

  describe('tools', () => {
    it('hides disabled tools, including one an adapter of the app provides, from tools/list', async () => {
      const listing = JSON.stringify(await client.listTools());

      expect(listing).toContain('"enabled_tool"');
      expect(listing).toContain('"enabled_adapter_tool"');
      expect(listing).not.toContain('"disabled_tool"');
      expect(listing).not.toContain('"disabled_adapter_tool"');
    });

    it('refuses tools/call on a disabled tool', async () => {
      const result = JSON.stringify(await client.callTool('disabled_tool', {}));

      expect(result).toContain('"isError":true');
      expect(result).toContain('disabled by feature flag');
    });

    it('refuses tools/call on a disabled tool an adapter of the app provides', async () => {
      const result = JSON.stringify(await client.callTool('disabled_adapter_tool', {}));

      expect(result).toContain('"isError":true');
      expect(result).toContain('disabled by feature flag');
      expect(result).not.toContain('"ran"');
    });

    it('runs enabled tools, including one an adapter of the app provides', async () => {
      expect(JSON.stringify(await client.callTool('enabled_tool', {}))).toContain('enabled_tool');
      expect(JSON.stringify(await client.callTool('enabled_adapter_tool', {}))).toContain('enabled_adapter_tool');
    });
  });

  describe('resources', () => {
    it('hides a disabled resource from resources/list', async () => {
      const { resources } = await client.listResources();
      const uris = resources.map((resource) => resource.uri);

      expect(uris).toContain('flags://enabled');
      expect(uris).not.toContain('flags://disabled');
    });

    it('refuses resources/read on a disabled resource', async () => {
      expect(await errorMessageOf(client.readResource('flags://disabled'))).toContain('disabled by feature flag');
    });

    it('reads an enabled resource', async () => {
      const { contents } = await client.readResource('flags://enabled');

      expect(contents[0]).toMatchObject({ uri: 'flags://enabled', text: 'content of flags://enabled' });
    });
  });

  describe('resource templates', () => {
    it('hides a disabled resource template from resources/templates/list', async () => {
      const { resourceTemplates } = await client.listResourceTemplates();
      const names = resourceTemplates.map((template) => template.name);

      expect(names).toContain('enabled-template');
      expect(names).not.toContain('disabled-template');
    });

    it('refuses resources/read on a URI a disabled template matches', async () => {
      expect(await errorMessageOf(client.readResource('flags://disabled-report/1'))).toContain(
        'disabled by feature flag',
      );
    });

    it('reads a URI an enabled template matches', async () => {
      const { contents } = await client.readResource('flags://enabled-report/1');

      expect(contents[0]).toMatchObject({ text: 'content of flags://enabled-report/1' });
    });
  });

  describe('prompts', () => {
    it('hides a disabled prompt from prompts/list', async () => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((prompt) => prompt.name);

      expect(names).toContain('enabled-prompt');
      expect(names).not.toContain('disabled-prompt');
    });

    it('refuses prompts/get on a disabled prompt', async () => {
      expect(await errorMessageOf(client.getPrompt('disabled-prompt', { topic: 'x' }))).toContain(
        'disabled by feature flag',
      );
    });

    it('gets an enabled prompt', async () => {
      const { messages } = await client.getPrompt('enabled-prompt', { topic: 'x' });

      expect(messages[0]?.content).toMatchObject({ text: 'enabled prompt' });
    });
  });

  describe('completion/complete', () => {
    it('refuses to complete an argument of a disabled resource template', async () => {
      const completion = errorMessageOf(
        client.complete({
          ref: { type: 'ref/resource', uri: 'flags://disabled-report/{reportId}' },
          argument: { name: 'reportId', value: '' },
        }),
      );

      expect(await completion).toContain('disabled by feature flag');
    });

    it('refuses to complete an argument of a disabled prompt', async () => {
      const completion = errorMessageOf(
        client.complete({
          ref: { type: 'ref/prompt', name: 'disabled-prompt' },
          argument: { name: 'topic', value: '' },
        }),
      );

      expect(await completion).toContain('disabled by feature flag');
    });

    it('completes an argument of an enabled resource template', async () => {
      const { completion } = await client.complete({
        ref: { type: 'ref/resource', uri: 'flags://enabled-report/{reportId}' },
        argument: { name: 'reportId', value: '' },
      });

      expect(completion.values).toEqual(['enabled-report-1']);
    });
  });

  describe('skills over MCP', () => {
    it('hides a disabled skill from skills/search', async () => {
      const { skills } = await client.searchSkills('flagged workflow');
      const ids = skills.map((skill) => skill.id);

      expect(ids).toContain('enabled-skill');
      expect(ids).not.toContain('disabled-skill');
    });

    it('hides a disabled skill from skills/list', async () => {
      const { skills } = await client.listSkills();
      const ids = skills.map((skill) => skill.id);

      expect(ids).toContain('enabled-skill');
      expect(ids).not.toContain('disabled-skill');
    });

    it('refuses skills/load on a disabled skill', async () => {
      const { skills, summary } = await client.loadSkills(['disabled-skill']);

      expect(skills).toEqual([]);
      expect(summary.combinedWarnings).toEqual(['Skill "disabled-skill" not found']);
    });

    it('loads an enabled skill', async () => {
      const { skills } = await client.loadSkills(['enabled-skill']);

      expect(skills.map((skill) => skill.id)).toEqual(['enabled-skill']);
      expect(skills[0]?.instructions).toContain('Enabled flagged workflow steps.');
    });
  });

  describe('skills over SEP-2640 skill:// resources', () => {
    it('leaves the SKILL.md resource of a disabled skill out of resources/list', async () => {
      const { resources } = await client.listResources();
      const uris = resources.map((resource) => resource.uri);

      expect(uris).toContain('skill://enabled-skill/SKILL.md');
      expect(uris).not.toContain('skill://disabled-skill/SKILL.md');
    });

    it('leaves a disabled skill out of skill://index.json', async () => {
      const index = JSON.parse(textOf(await client.readResource('skill://index.json'))) as {
        skills: Array<{ name: string }>;
      };
      const names = index.skills.map((entry) => entry.name);

      expect(names).toContain('enabled-skill');
      expect(names).not.toContain('disabled-skill');
    });

    it('refuses to read the SKILL.md of a disabled skill', async () => {
      const message = await errorMessageOf(client.readResource('skill://disabled-skill/SKILL.md'));

      expect(message).not.toBe('resolved');
      expect(message).not.toContain('Disabled flagged workflow steps.');
    });

    it('refuses to read a file inside a disabled skill', async () => {
      const message = await errorMessageOf(client.readResource('skill://disabled-skill/references/notes.md'));

      expect(message).not.toBe('resolved');
      expect(message).not.toContain('Flagged workflow reference notes.');
    });

    it('reads a file inside an enabled skill', async () => {
      const content = textOf(await client.readResource('skill://enabled-skill/references/notes.md'));

      expect(content).toContain('Flagged workflow reference notes.');
    });

    it('does not complete the path of a disabled skill', async () => {
      const { completion } = await client.complete({
        ref: { type: 'ref/resource', uri: 'skill://{+skillPath}/SKILL.md' },
        argument: { name: 'skillPath', value: '' },
      });

      expect(completion.values).toContain('enabled-skill');
      expect(completion.values).not.toContain('disabled-skill');
    });

    it('reads the SKILL.md of an enabled skill', async () => {
      expect(textOf(await client.readResource('skill://enabled-skill/SKILL.md'))).toContain(
        'Enabled flagged workflow steps.',
      );
    });
  });

  describe('skills over the HTTP skills API', () => {
    let fetchSkills: (path: string) => Promise<{ status: number; body: string }>;

    beforeAll(async () => {
      const instance = await FrontMcpInstance.createForGraph(serverConfig);
      const handler = createWebFetchHandler(instance.getScopes()[0] as WebFetchScope);
      fetchSkills = async (path) => {
        const response = await handler(new Request(new URL(path, 'http://localhost')));
        return { status: response.status, body: await response.text() };
      };
    });

    it('refuses GET /skills/{id} for a disabled skill', async () => {
      const { status, body } = await fetchSkills('/skills/disabled-skill');

      expect(status).toBe(404);
      expect(body).not.toContain('Disabled flagged workflow steps.');
    });

    it('answers GET /skills/{id} for a disabled skill exactly like a skill that does not exist', async () => {
      const disabled = await fetchSkills('/skills/disabled-skill');
      const missing = await fetchSkills('/skills/no-such-skill');

      expect(disabled.status).toBe(missing.status);
      expect(disabled.body).toBe(missing.body.replace('no-such-skill', 'disabled-skill'));
    });

    it('leaves a disabled skill out of GET /skills', async () => {
      const { status, body } = await fetchSkills('/skills');

      expect(status).toBe(200);
      expect(body).toContain('enabled-skill');
      expect(body).not.toContain('disabled-skill');
    });

    it('leaves a disabled skill out of GET /skills?query=', async () => {
      const { status, body } = await fetchSkills('/skills?query=flagged%20workflow');

      expect(status).toBe(200);
      expect(body).toContain('enabled-skill');
      expect(body).not.toContain('disabled-skill');
    });

    it('serves GET /skills/{id} for an enabled skill', async () => {
      const { status, body } = await fetchSkills('/skills/enabled-skill');

      expect(status).toBe(200);
      expect(body).toContain('Enabled flagged workflow steps.');
    });
  });
});

@ResourceTemplate({ name: 'north-report', uriTemplate: 'north://report/{reportId}', featureFlag: 'north-reports' })
class NorthReportTemplate extends ResourceContext<{ reportId: string }> {
  async reportIdCompleter(): Promise<ResourceCompletionResult> {
    return { values: ['north-report-1'] };
  }

  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Prompt({ name: 'north-prompt', arguments: [{ name: 'topic' }], featureFlag: 'north-reports' })
class NorthPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt('north prompt');
  }
}

@App({
  id: 'north',
  name: 'North',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: { 'north-reports': true } })],
  resources: [NorthReportTemplate],
  prompts: [NorthPrompt],
})
class NorthApp {}

@App({
  id: 'south',
  name: 'South',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: { 'north-reports': false } })],
})
class SouthApp {}

describe('FeatureFlagPlugin installed on two apps with their own flags', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'feature-flag-two-apps', version: '1.0.0' },
      apps: [NorthApp, SouthApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('completes an argument of a resource template its own app enables', async () => {
    const { completion } = await client.complete({
      ref: { type: 'ref/resource', uri: 'north://report/{reportId}' },
      argument: { name: 'reportId', value: '' },
    });

    expect(completion.values).toEqual(['north-report-1']);
  });

  it('completes an argument of a prompt its own app enables', async () => {
    const completion = errorMessageOf(
      client.complete({ ref: { type: 'ref/prompt', name: 'north-prompt' }, argument: { name: 'topic', value: '' } }),
    );

    expect(await completion).toBe('resolved');
  });

  it('reads a resource its own app enables', async () => {
    const { contents } = await client.readResource('north://report/1');

    expect(contents[0]).toMatchObject({ text: 'content of north://report/1' });
  });
});

describe('FeatureFlagPlugin and the skill catalog in the initialize instructions (#603)', () => {
  async function instructionsFor(config: FrontMcpConfigInput, options: { skillUriHints?: boolean } = {}) {
    const instance = await FrontMcpInstance.createForGraph(config);
    const [scope] = instance.getScopes();
    if (!scope) throw new Error('the config produced no scope');
    return composeCallerInstructions(scope, { ctx: { authInfo: { sessionId: 'caller-session' } }, ...options });
  }

  it('lists an enabled skill and leaves a disabled one out of the catalog', async () => {
    const instructions = await instructionsFor(serverConfig);

    expect(instructions).toContain('**enabled-skill**: Enabled flagged workflow');
    expect(instructions).not.toContain('disabled-skill');
    expect(instructions).not.toContain('Disabled flagged workflow');
  });

  it('leaves a disabled skill out of the SEP-2640 skill:// hints', async () => {
    const instructions = await instructionsFor(
      { ...serverConfig, skillsConfig: { enabled: true, sep2640InInstructions: true } },
      { skillUriHints: true },
    );

    expect(instructions).toContain('skill://enabled-skill/SKILL.md');
    expect(instructions).not.toContain('skill://disabled-skill/SKILL.md');
  });
});

const SWAPPABLE_PATH = 'swappable-skill';

@Skill({
  name: SWAPPABLE_PATH,
  description: 'Swappable flagged workflow',
  instructions: 'Swappable flagged workflow steps.',
  featureFlag: 'flag-off',
})
class SwappableSkill extends SkillContext {}

// Hot-swaps the skill served at the path: a dynamic registration shadows the app's flag-off skill.
@Tool({ name: 'shadow_swappable_skill', inputSchema: {} })
class ShadowSwappableSkillTool extends ToolContext {
  async execute() {
    await this.scope.skills.registerSkillContent({
      id: SWAPPABLE_PATH,
      name: SWAPPABLE_PATH,
      description: 'Unflagged replacement workflow',
      instructions: 'Unflagged replacement steps.',
      tools: [],
    });
    return { shadowed: true };
  }
}

@Tool({ name: 'unshadow_swappable_skill', inputSchema: {} })
class UnshadowSwappableSkillTool extends ToolContext {
  async execute() {
    await this.scope.skills.unregisterSkill(SWAPPABLE_PATH);
    return { shadowed: false };
  }
}

@App({
  id: 'swappable',
  name: 'Swappable',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: FLAGS })],
  tools: [ShadowSwappableSkillTool, UnshadowSwappableSkillTool],
  skills: [SwappableSkill],
})
class SwappableApp {}

describe('FeatureFlagPlugin and a skill replaced at the same skill:// path (#606)', () => {
  let client: DirectClient;

  const listsSkillMd = async () => {
    const { resources } = await client.listResources();
    return resources.some((resource) => resource.uri === `skill://${SWAPPABLE_PATH}/SKILL.md`);
  };

  beforeAll(async () => {
    client = await connect({
      info: { name: 'feature-flag-swap', version: '1.0.0' },
      apps: [SwappableApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('leaves the SKILL.md of the flag-off skill out of resources/list', async () => {
    expect(await listsSkillMd()).toBe(false);
  });

  it('lists the SKILL.md once an unflagged skill replaces it at the same path', async () => {
    await client.callTool('shadow_swappable_skill', {});

    expect(await listsSkillMd()).toBe(true);
    expect(textOf(await client.readResource(`skill://${SWAPPABLE_PATH}/SKILL.md`))).toContain(
      'Unflagged replacement steps.',
    );
  });

  it('drops the SKILL.md again once the flag-off skill is back at the path', async () => {
    await client.callTool('unshadow_swappable_skill', {});

    expect(await listsSkillMd()).toBe(false);
  });
});
