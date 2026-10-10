import 'reflect-metadata';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  TEST_CLIENT_INFO,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Resource, ResourceContext, Tool, ToolContext } from '../../../common';

const NOTE_URI = 'notes://today';

@Resource({ name: 'today-note', uri: NOTE_URI, mimeType: 'text/plain' })
class TodayNoteResource extends ResourceContext {
  async execute() {
    return 'buy milk';
  }
}

@Tool({ name: 'edit_note', inputSchema: {} })
class EditNoteTool extends ToolContext {
  async execute() {
    this.notifyResourceUpdated(NOTE_URI);
    return { saved: true };
  }
}

@App({ id: 'notes', name: 'Notes', tools: [EditNoteTool], resources: [TodayNoteResource] })
class NotesApp {}

function listen(server: TestFetchServer, signal: AbortSignal): Promise<Response> {
  return server.handler(
    new Request('http://localhost/', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': 'subscriptions/listen',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'listen-1',
        method: 'subscriptions/listen',
        params: {
          notifications: { resourceSubscriptions: [NOTE_URI] },
          _meta: {
            [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
            [MCP_20260728_META.clientInfo]: TEST_CLIENT_INFO,
            [MCP_20260728_META.clientCapabilities]: {},
          },
        },
      }),
    }),
  );
}

async function nextMessage(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 2_000) {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (!text.includes('\n\n')) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), remaining);
      }),
    ]);
    clearTimeout(timer);
    if (!chunk || chunk.done) return undefined;
    text += decoder.decode(chunk.value);
  }
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('');
  return JSON.parse(data) as Record<string, unknown>;
}

describe('a resource update a tool reports, on a subscriptions/listen stream', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'listen-resource-updated', version: '1.0.0' },
      apps: [NotesApp],
    });
  });

  afterAll(async () => {
    await server.instance.shutdown();
  });

  it('reaches a stream subscribed to the resource', async () => {
    const controller = new AbortController();
    const response = await listen(server, controller.signal);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const acknowledgement = await nextMessage(reader);

    await rpc20260728(server.handler, 'tools/call', { name: 'edit_note', arguments: {} });
    const notification = await nextMessage(reader, 1_000);

    expect(acknowledgement?.['method']).toBe('notifications/subscriptions/acknowledged');
    expect(notification).toEqual(
      expect.objectContaining({
        method: 'notifications/resources/updated',
        params: expect.objectContaining({ uri: NOTE_URI }),
      }),
    );

    // The stream ends once its pending read settles, so one more update lets the cancellation through.
    const cancelled = reader.cancel();
    await rpc20260728(server.handler, 'tools/call', { name: 'edit_note', arguments: {} });
    await cancelled;
    controller.abort();
  }, 10_000);
});
