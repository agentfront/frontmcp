import 'reflect-metadata';

import { App, LogLevel, ResourceContext, ResourceTemplate } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@ResourceTemplate({ name: 'ticket', uriTemplate: 'tickets://{id}', mimeType: 'application/json' })
class TicketResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, { id }: { id: string }) {
    if (id === 'T-0') this.respond({ contents: [{ uri, text: '{}' }] });
    if (id === 'T-9') this.respond('archived' as never);
    return { contents: [{ uri, text: JSON.stringify({ id }) }] };
  }
}

@App({ id: 'desk', name: 'Desk', resources: [TicketResource] })
class DeskApp {}

describe('this.respond() in a resource', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'resource-respond', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('ends the read with the value as its result', async () => {
    const result = await server.readResource('tickets://T-0');

    expect(result.contents).toEqual([expect.objectContaining({ uri: 'tickets://T-0', text: '{}' })]);
  });

  it('normalizes the value as a returned one', async () => {
    const result = await server.readResource('tickets://T-9');

    expect(result.contents).toEqual([expect.objectContaining({ uri: 'tickets://T-9', text: 'archived' })]);
  });

  it('leaves a returned value as it was', async () => {
    const result = await server.readResource('tickets://T-1');

    expect(result.contents).toEqual([expect.objectContaining({ text: JSON.stringify({ id: 'T-1' }) })]);
  });
});
