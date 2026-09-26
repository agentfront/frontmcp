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
