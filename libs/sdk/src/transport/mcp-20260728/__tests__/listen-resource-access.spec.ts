/**
 * A `subscriptions/listen` stream is told of a resource's changes only when its caller may read the resource:
 * each requested URI runs through `resources:subscribe` (availability, `enabled`, authorities), a refused one is
 * left out of the acknowledgement, and an update of a resource under an acknowledged URI is checked the same way.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  TEST_CLIENT_INFO,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Resource, ResourceContext, Tool, ToolContext } from '../../../common';
import { MaterializedResourceContext } from '../../../resource/materialized/materialized-resource.context';
import { resourceStore } from '../../../resource/materialized/resource-store';

const store = resourceStore({ coalesceMs: 0 });
const board = store.key<{ open: number }>('board', { initial: { open: 0 } });

@Resource({ name: 'board', uri: 'board://status', from: board })
class BoardResource extends MaterializedResourceContext {}

@Resource({ name: 'today-note', uri: 'notes://today' })
class TodayNoteResource extends ResourceContext {
  async execute() {
    return 'buy milk';
  }
}

@Resource({ name: 'secret-note', uri: 'notes://today/secret', authorities: 'admin' })
class SecretNoteResource extends ResourceContext {
  async execute() {
    return 'the safe code';
  }
}

@Resource({ name: 'admin-board', uri: 'admin://board', authorities: 'admin' })
class AdminBoardResource extends ResourceContext {
  async execute() {
    return 'admin only';
  }
}

@Tool({ name: 'touch', inputSchema: { uri: z.string() } })
class TouchTool extends ToolContext {
  async execute(input: { uri: string }) {
    this.notifyResourceUpdated(input.uri);
    return { touched: input.uri };
  }
}

@App({
  id: 'notes',
  name: 'Notes',
  tools: [TouchTool],
  resources: [BoardResource, TodayNoteResource, SecretNoteResource, AdminBoardResource],
})
class NotesApp {}

function listen(server: TestFetchServer, uris: string[], signal: AbortSignal): Promise<Response> {
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
        id: 'listen-access',
        method: 'subscriptions/listen',
        params: {
          notifications: { resourceSubscriptions: uris },
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

/** Collect the stream's messages until `done` says so or `timeoutMs` passes. */
async function collect(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  done: (messages: Record<string, unknown>[]) => boolean,
  timeoutMs = 2_000,
): Promise<Record<string, unknown>[]> {
  const decoder = new TextDecoder();
  const messages: Record<string, unknown>[] = [];
  let pending = '';
  const deadline = Date.now() + timeoutMs;
  while (!done(messages)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), remaining);
      }),
    ]);
    clearTimeout(timer);
    if (!chunk || chunk.done) break;
    pending += decoder.decode(chunk.value);
    const events = pending.split('\n\n');
    pending = events.pop() ?? '';
    for (const event of events) {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('');
      if (data) messages.push(JSON.parse(data) as Record<string, unknown>);
    }
  }
  return messages;
}

function updatedUris(messages: Record<string, unknown>[]): string[] {
  return messages
    .filter((message) => message['method'] === 'notifications/resources/updated')
    .map((message) => (message['params'] as { uri: string }).uri);
}

describe('a subscriptions/listen stream and resource access', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'listen-resource-access', version: '1.0.0' },
      apps: [NotesApp],
      authorities: { claimsMapping: { roles: 'roles' }, profiles: { admin: { roles: { any: ['admin'] } } } },
    });
  });

  afterAll(async () => {
    await server.instance.shutdown();
  });

  it("receives a materialized resource's update when its stored value changes", async () => {
    const controller = new AbortController();
    const reader = (await listen(server, ['board://status'], controller.signal)).body?.getReader();
    if (!reader) throw new Error('no stream');
    await collect(reader, (messages) => messages.length === 1);

    await board.update((current) => ({ open: current.open + 1 }));
    const messages = await collect(reader, (received) => updatedUris(received).length === 1);

    expect(updatedUris(messages)).toEqual(['board://status']);
    const cancelled = reader.cancel();
    await board.set({ open: 0 });
    await cancelled;
    controller.abort();
  });

  it('acknowledges only the resources the caller may read, and sends only their updates', async () => {
    const controller = new AbortController();
    const reader = (
      await listen(server, ['notes://today', 'admin://board', 'nothing://here'], controller.signal)
    ).body?.getReader();
    if (!reader) throw new Error('no stream');
    const [acknowledgement] = await collect(reader, (messages) => messages.length === 1);

    for (const uri of ['admin://board', 'notes://today/secret', 'notes://today/draft', 'notes://today']) {
      await rpc20260728(server.handler, 'tools/call', { name: 'touch', arguments: { uri } });
    }
    const messages = await collect(reader, (received) => updatedUris(received).length === 2);
    await collect(reader, () => false, 300).then((late) => messages.push(...late));

    expect((acknowledgement['params'] as { notifications: unknown }).notifications).toEqual({
      resourceSubscriptions: ['notes://today'],
    });
    expect(updatedUris(messages).sort()).toEqual(['notes://today', 'notes://today/draft']);
    // The stream ends once its pending read settles, so one more update lets the cancellation through.
    const cancelled = reader.cancel();
    await rpc20260728(server.handler, 'tools/call', { name: 'touch', arguments: { uri: 'notes://today' } });
    await cancelled;
    controller.abort();
  });
});
