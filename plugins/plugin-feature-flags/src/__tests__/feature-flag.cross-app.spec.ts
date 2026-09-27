/**
 * `FeatureFlagPlugin` installed on one app, and flagged entries in another app that has no
 * feature-flag plugin of its own.
 *
 * The plugin's list hooks already filtered every app's entries, but its gates were hooks of the
 * app it was installed on, and the SDK runs an app's hooks only for that app's entries: another
 * app's flagged-off tool was hidden from tools/list yet ran when called by name, and the same for
 * resources, resource templates, prompts and completion. The gates now also cover the entries
 * of apps that have no feature-flag plugin of their own.
 */
import 'reflect-metadata';

import {
  App,
  connect,
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
  type DirectClient,
  type GetPromptResult,
  type ReadResourceResult,
  type ResourceCompletionResult,
} from '@frontmcp/sdk';

import FeatureFlagPlugin from '../feature-flag.plugin';

const FLAGS = { 'flag-on': true, 'flag-off': false };

function textResource(uri: string): ReadResourceResult {
  return { contents: [{ uri, text: `content of ${uri}` }] };
}

function errorMessageOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

@Tool({ name: 'own_disabled_tool', inputSchema: {}, featureFlag: 'flag-off' })
class OwnDisabledTool extends ToolContext {
  async execute() {
    return { ran: 'own_disabled_tool' };
  }
}

@Tool({ name: 'other_disabled_tool', inputSchema: {}, featureFlag: 'flag-off' })
class OtherDisabledTool extends ToolContext {
  async execute() {
    return { ran: 'other_disabled_tool' };
  }
}

@Tool({ name: 'other_enabled_tool', inputSchema: {}, featureFlag: 'flag-on' })
class OtherEnabledTool extends ToolContext {
  async execute() {
    return { ran: 'other_enabled_tool' };
  }
}

@Resource({ name: 'other-disabled-resource', uri: 'other://disabled', featureFlag: 'flag-off' })
class OtherDisabledResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@ResourceTemplate({ name: 'other-disabled-template', uriTemplate: 'other://report/{id}', featureFlag: 'flag-off' })
class OtherDisabledTemplate extends ResourceContext<{ id: string }> {
  async idCompleter(): Promise<ResourceCompletionResult> {
    return { values: ['report-1'] };
  }

  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Prompt({ name: 'other-disabled-prompt', arguments: [{ name: 'topic' }], featureFlag: 'flag-off' })
class OtherDisabledPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'disabled prompt' } }] };
  }
}

@Skill({
  name: 'other-disabled-skill',
  description: 'Disabled billing workflow',
  instructions: 'Disabled billing workflow steps.',
  featureFlag: 'flag-off',
})
class OtherDisabledSkill extends SkillContext {}

@App({
  id: 'help-desk',
  name: 'Help Desk',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: FLAGS })],
  tools: [OwnDisabledTool],
})
class HelpDeskApp {}

@App({
  id: 'billing',
  name: 'Billing',
  tools: [OtherDisabledTool, OtherEnabledTool],
  resources: [OtherDisabledResource, OtherDisabledTemplate],
  prompts: [OtherDisabledPrompt],
  skills: [OtherDisabledSkill],
})
class BillingApp {}

describe('FeatureFlagPlugin installed on one app of a server with several apps', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'feature-flag-cross-app', version: '1.0.0' },
      apps: [HelpDeskApp, BillingApp],
      logging: { level: LogLevel.Off },
      skillsConfig: { enabled: true },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it("hides another app's disabled tool from tools/list", async () => {
    const listing = JSON.stringify(await client.listTools());

    expect(listing).not.toContain('"other_disabled_tool"');
    expect(listing).toContain('"other_enabled_tool"');
  });

  it("refuses tools/call on another app's disabled tool", async () => {
    const result = JSON.stringify(await client.callTool('other_disabled_tool', {}));

    expect(result).toContain('"isError":true');
    expect(result).toContain('disabled by feature flag');
    expect(result).not.toContain('"ran"');
  });

  it("runs another app's enabled tool", async () => {
    expect(JSON.stringify(await client.callTool('other_enabled_tool', {}))).toContain('"ran":"other_enabled_tool"');
  });

  it("still refuses the plugin's own app's disabled tool", async () => {
    expect(JSON.stringify(await client.callTool('own_disabled_tool', {}))).toContain('disabled by feature flag');
  });

  it("refuses resources/read on another app's disabled resource", async () => {
    expect(await errorMessageOf(client.readResource('other://disabled'))).toContain('disabled by feature flag');
  });

  it("refuses resources/read on a URI another app's disabled template matches", async () => {
    expect(await errorMessageOf(client.readResource('other://report/1'))).toContain('disabled by feature flag');
  });

  it("refuses prompts/get on another app's disabled prompt", async () => {
    expect(await errorMessageOf(client.getPrompt('other-disabled-prompt', { topic: 'x' }))).toContain(
      'disabled by feature flag',
    );
  });

  it("refuses to complete an argument of another app's disabled template", async () => {
    const completion = client.complete({
      ref: { type: 'ref/resource', uri: 'other://report/{id}' },
      argument: { name: 'id', value: '' },
    });

    expect(await errorMessageOf(completion)).toContain('disabled by feature flag');
  });

  it("refuses to complete an argument of another app's disabled prompt", async () => {
    const completion = client.complete({
      ref: { type: 'ref/prompt', name: 'other-disabled-prompt' },
      argument: { name: 'topic', value: '' },
    });

    expect(await errorMessageOf(completion)).toContain('disabled by feature flag');
  });

  it("leaves another app's disabled skill out of skills/list and refuses to load it", async () => {
    const { skills } = await client.listSkills();
    expect(skills.map((skill) => skill.id)).not.toContain('other-disabled-skill');

    const loaded = await client.loadSkills(['other-disabled-skill']);
    expect(loaded.skills).toEqual([]);
  });
});
