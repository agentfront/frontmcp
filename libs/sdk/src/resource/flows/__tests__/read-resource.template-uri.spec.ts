import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, ResourceContext, ResourceTemplate } from '../../../common';

@ResourceTemplate({ name: 'ticket', uriTemplate: 'tickets://{id}', mimeType: 'application/json' })
class TicketResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }) {
    return { id: params.id, title: 'Printer on fire' };
  }
}

@ResourceTemplate({ name: 'note', uriTemplate: 'notes://{id}', mimeType: 'text/plain' })
class NoteResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }) {
    return `Note ${params.id}`;
  }
}

@ResourceTemplate({ name: 'attachments', uriTemplate: 'attachments://{id}', mimeType: 'text/plain' })
class AttachmentsResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }) {
    return [{ text: `a.txt of ${params.id}` }, { text: `b.txt of ${params.id}` }];
  }
}

@App({ id: 'desk', name: 'Desk', resources: [TicketResource, NoteResource, AttachmentsResource] })
class DeskApp {}

describe('resources/read on a resource template that returns a shorthand value', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'template-uri', version: '1.0.0' }, apps: [DeskApp] });
  });

  async function readContentUris(uri: string): Promise<string[]> {
    const { message } = await rpc20260728(server.handler, 'resources/read', { uri });
    const contents = (message.result?.['contents'] as Array<{ uri: string }> | undefined) ?? [];
    return contents.map((content) => content.uri);
  }

  it('uses the read URI for a plain object result', async () => {
    expect(await readContentUris('tickets://42')).toEqual(['tickets://42']);
  });

  it('uses the read URI for a string result', async () => {
    expect(await readContentUris('notes://7')).toEqual(['notes://7']);
  });

  it('bases every content URI of an array result on the read URI', async () => {
    const uris = await readContentUris('attachments://9');

    expect(uris).toHaveLength(2);
    expect(uris.filter((uri) => !uri.startsWith('attachments://9'))).toEqual([]);
  });
});
