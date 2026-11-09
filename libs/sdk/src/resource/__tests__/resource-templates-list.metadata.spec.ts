import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import { App, LogLevel, ResourceContext, ResourceTemplate } from '../../common';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';

@ResourceTemplate({
  name: 'ticket',
  uriTemplate: 'tickets://{id}',
  annotations: { audience: ['assistant'], priority: 0.4 },
  _meta: { 'com.example/owner': 'support' },
})
class TicketTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'ticket' }] };
  }
}

@ResourceTemplate({
  name: 'ticket_card',
  uriTemplate: 'ui://tickets/{id}',
  mimeType: 'text/html;profile=mcp-app',
  _meta: { ui: { prefersBorder: true } },
})
class TicketCardTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: '<p>ticket</p>' }] };
  }
}

@ResourceTemplate({ name: 'plain', uriTemplate: 'plain://{id}' })
class PlainTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'plain' }] };
  }
}

@App({ id: 'desk', name: 'Desk', resources: [TicketTemplate, TicketCardTemplate, PlainTemplate] })
class DeskApp {}

const serverConfig = {
  info: { name: 'templates-list-metadata', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
  clients: { 'text-agent': { annotations: 'no-numbers' as const } },
};

describe("resources/templates/list keeps a template's annotations and _meta (#1173)", () => {
  const clients: DirectClient[] = [];

  async function templatesFor(clientName: string) {
    const client = await connect(serverConfig, { clientInfo: { name: clientName, version: '1.0.0' } });
    clients.push(client);
    const { resourceTemplates } = await client.listResourceTemplates();
    return new Map(resourceTemplates.map((template) => [template.name, template]));
  }

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
  });

  it('lists the annotations and _meta the template declares', async () => {
    const templates = await templatesFor('acme-agent');

    expect(templates.get('ticket')).toMatchObject({
      annotations: { audience: ['assistant'], priority: 0.4 },
      _meta: { 'com.example/owner': 'support' },
    });
    expect(templates.get('plain')).not.toHaveProperty('annotations');
    expect(templates.get('plain')).not.toHaveProperty('_meta');
  });

  it("keeps a widget template's own ui keys next to its resourceUri", async () => {
    const templates = await templatesFor('acme-agent');

    expect(templates.get('ticket_card')?._meta).toEqual({
      ui: { prefersBorder: true, resourceUri: 'ui://tickets/{id}' },
    });
  });

  it('drops numeric annotations for an annotations: no-numbers client, as resources/list does', async () => {
    const templates = await templatesFor('text-agent');

    expect(templates.get('ticket')?.annotations).toEqual({ audience: ['assistant'] });
  });
});
