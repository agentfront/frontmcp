/**
 * A `FeatureFlagPlugin` on each of two apps, with different flag values.
 *
 * Each entry must be judged by the plugin that covers its app, the same one for listing it and for
 * serving it. In 1.8.3 every app's plugin filtered every app's listings, while a call, read, get or
 * completion was judged only by the entry's own app's plugin: an entry the other app's plugin had
 * off was missing from its listing and still served by name, and one it had on was listed wherever
 * the other plugin agreed. A third app with no plugin of its own is covered by both, for listing and
 * serving alike.
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

/** The help desk turns bulk export on and the billing flags off; billing does the reverse. */
const HELP_DESK_FLAGS = { 'bulk-export': true, 'instant-refunds': false, 'ops-beta': false };
const BILLING_FLAGS = { 'bulk-export': false, 'instant-refunds': true, 'ops-beta': true };

function textResource(uri: string): ReadResourceResult {
  return { contents: [{ uri, text: `content of ${uri}` }] };
}

function outcomeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'served',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

@Tool({ name: 'bulk_export', inputSchema: {}, featureFlag: 'bulk-export' })
class BulkExportTool extends ToolContext {
  async execute() {
    return { ran: 'bulk_export' };
  }
}

@Tool({ name: 'refund_invoice', inputSchema: {}, featureFlag: 'instant-refunds' })
class RefundInvoiceTool extends ToolContext {
  async execute() {
    return { ran: 'refund_invoice' };
  }
}

@Tool({ name: 'ops_beta', inputSchema: {}, featureFlag: 'ops-beta' })
class OpsBetaTool extends ToolContext {
  async execute() {
    return { ran: 'ops_beta' };
  }
}

@Resource({ name: 'desk-exports', uri: 'desk://exports', featureFlag: 'bulk-export' })
class DeskExportsResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@ResourceTemplate({ name: 'refund-receipt', uriTemplate: 'billing://refunds/{id}', featureFlag: 'instant-refunds' })
class RefundReceiptTemplate extends ResourceContext<{ id: string }> {
  async idCompleter(): Promise<ResourceCompletionResult> {
    return { values: ['refund-1'] };
  }

  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Prompt({ name: 'refund-reply', arguments: [{ name: 'topic' }], featureFlag: 'instant-refunds' })
class RefundReplyPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'refund reply' } }] };
  }
}

@Skill({
  name: 'export-runbook',
  description: 'How to run a bulk export',
  instructions: 'Export the tickets in bulk.',
  featureFlag: 'bulk-export',
})
class ExportRunbookSkill extends SkillContext {}

@App({
  id: 'help-desk',
  name: 'Help Desk',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: HELP_DESK_FLAGS })],
  tools: [BulkExportTool],
  resources: [DeskExportsResource],
  skills: [ExportRunbookSkill],
})
class HelpDeskApp {}

@App({
  id: 'billing',
  name: 'Billing',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: BILLING_FLAGS })],
  tools: [RefundInvoiceTool],
  resources: [RefundReceiptTemplate],
  prompts: [RefundReplyPrompt],
})
class BillingApp {}

@App({ id: 'ops', name: 'Ops', tools: [OpsBetaTool] })
class OpsApp {}

describe('FeatureFlagPlugin on each of two apps', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'feature-flag-two-plugins', version: '1.0.0' },
      apps: [HelpDeskApp, BillingApp, OpsApp],
      logging: { level: LogLevel.Off },
      skillsConfig: { enabled: true },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  async function listedToolNames(): Promise<string[]> {
    const listing = JSON.stringify(await client.listTools());
    return ['bulk_export', 'refund_invoice', 'ops_beta'].filter((name) => listing.includes(`"${name}"`));
  }

  it("lists each app's tool that its own plugin has on", async () => {
    expect(await listedToolNames()).toEqual(['bulk_export', 'refund_invoice']);
  });

  it('lists exactly the tools that run when called', async () => {
    const listed = await listedToolNames();
    const ran: string[] = [];
    for (const name of ['bulk_export', 'refund_invoice', 'ops_beta']) {
      const result = JSON.stringify(await client.callTool(name, {}));
      if (result.includes(`"ran":"${name}"`)) ran.push(name);
    }
    expect(ran).toEqual(listed);
  });

  it('refuses the tool of an app without a plugin when either plugin has its flag off, and hides it', async () => {
    expect(JSON.stringify(await client.callTool('ops_beta', {}))).toContain('disabled by feature flag');
    expect(await listedToolNames()).not.toContain('ops_beta');
  });

  it("lists and reads the help desk's resource its own plugin has on", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain('desk://exports');
    expect(await outcomeOf(client.readResource('desk://exports'))).toBe('served');
  });

  it("lists and reads billing's resource template its own plugin has on", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toContain('billing://refunds/{id}');
    expect(await outcomeOf(client.readResource('billing://refunds/1'))).toBe('served');
    expect(
      await outcomeOf(
        client.complete({
          ref: { type: 'ref/resource', uri: 'billing://refunds/{id}' },
          argument: { name: 'id', value: '' },
        }),
      ),
    ).toBe('served');
  });

  it("lists and gets billing's prompt its own plugin has on", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toContain('refund-reply');
    expect(await outcomeOf(client.getPrompt('refund-reply', { topic: 'x' }))).toBe('served');
  });

  it("lists and loads the help desk's skill its own plugin has on", async () => {
    const { skills } = await client.listSkills();
    expect(skills.map((skill) => skill.id)).toContain('export-runbook');

    const loaded = await client.loadSkills(['export-runbook']);
    expect(loaded.skills.map((skill) => skill.id)).toEqual(['export-runbook']);
  });
});
