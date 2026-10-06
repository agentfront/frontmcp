/**
 * Entries of several apps on one server (#766):
 * - `prompts/get` accepts a prompt's app-qualified name (`desk:summarize`), which
 *   `prompts/list` hands out when two apps' prompts share a name;
 * - when two apps register the same resource URI, the first app serves it, the
 *   other is neither listed nor read, and startup warns.
 */
import 'reflect-metadata';

import { App, Prompt, PromptContext, Resource, ResourceContext, ResourceTemplate } from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

function summarizePrompt(text: string) {
  @Prompt({ name: 'summarize', arguments: [] })
  class SummarizePrompt extends PromptContext {
    async execute() {
      return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
    }
  }
  return SummarizePrompt;
}

function configResource(text: string) {
  @Resource({ name: 'config', uri: 'config://shared' })
  class ConfigResource extends ResourceContext {
    async execute(uri: string) {
      return { contents: [{ uri, text }] };
    }
  }
  return ConfigResource;
}

function ticketTemplate(text: string) {
  @ResourceTemplate({ name: 'ticket', uriTemplate: 'ticket://{id}' })
  class TicketTemplate extends ResourceContext<{ id: string }> {
    async execute(uri: string) {
      return { contents: [{ uri, text }] };
    }
  }
  return TicketTemplate;
}

@App({
  id: 'desk',
  name: 'Desk',
  prompts: [summarizePrompt('desk')],
  resources: [configResource('desk'), ticketTemplate('desk')],
})
class DeskApp {}

@App({
  id: 'billing',
  name: 'Billing',
  prompts: [summarizePrompt('billing')],
  resources: [configResource('billing'), ticketTemplate('billing')],
})
class BillingApp {}

describe('entries of several apps', () => {
  let server: DirectMcpServer;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    server = await FrontMcpInstance.createDirect({
      info: { name: 'multi', version: '1.0.0' },
      apps: [DeskApp, BillingApp],
    });
  });

  afterAll(async () => {
    await server.dispose();
    warn.mockRestore();
  });

  it('gets a prompt by the app-qualified name prompts/list gives it', async () => {
    const { prompts } = await server.listPrompts();
    const names = prompts.map((prompt) => prompt.name).sort();

    expect(names).toEqual(['billing:summarize', 'desk:summarize']);
    const billing = await server.getPrompt('billing:summarize');
    expect(JSON.stringify(billing.messages)).toContain('billing');
  });

  it('serves and lists a shared resource URI from the first app only', async () => {
    const { resources } = await server.listResources();
    const read = await server.readResource('config://shared');

    expect(resources.filter((resource) => resource.uri === 'config://shared')).toHaveLength(1);
    expect(JSON.stringify(read.contents)).toContain('desk');
    expect(JSON.stringify(warn.mock.calls)).toContain('Resource URI \\"config://shared\\" is registered by both');
  });

  it('lists and matches a shared URI template from the first app only', async () => {
    const { resourceTemplates } = await server.listResourceTemplates();
    const read = await server.readResource('ticket://42');

    expect(resourceTemplates.filter((template) => template.uriTemplate === 'ticket://{id}')).toHaveLength(1);
    expect(JSON.stringify(read.contents)).toContain('desk');
  });
});
