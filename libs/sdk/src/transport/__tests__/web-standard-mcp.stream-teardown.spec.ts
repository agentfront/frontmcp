/**
 * A stateless Worker request that streams its reply hands its server's teardown to `ctx.waitUntil`. That promise has
 * to settle once the stream ends, or the runtime cancels it as hung after every streamed reply.
 */
import 'reflect-metadata';

import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { createWebFetchHandler, type WebFetchHandler } from '../web-fetch-handler';

@App({ id: 'stream-teardown-app', name: 'stream-teardown-app' })
class StreamTeardownApp {}

const WORKER_URL = 'https://worker.example.com/';

const INITIALIZE = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy-client', version: '1.0.0' } },
};

function streamedInitialize(): Request {
  return new Request(WORKER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(INITIALIZE),
  });
}

function recordingCtx(): { ctx: { waitUntil(promise: Promise<unknown>): void }; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (promise) => pending.push(promise) }, pending };
}

async function settles(promise: Promise<unknown>): Promise<boolean> {
  const stillPending = Symbol('pending');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<symbol>((resolve) => {
    timer = setTimeout(() => resolve(stillPending), 1000);
  });
  const outcome = await Promise.race([promise.then(() => undefined), deadline]);
  clearTimeout(timer);
  return outcome !== stillPending;
}

describe('runWebStandardMcp stateless stream teardown', () => {
  let instance: FrontMcpInstance;
  let handler: WebFetchHandler;

  beforeAll(async () => {
    instance = await FrontMcpInstance.createForGraph({
      info: { name: 'stream-teardown-test', version: '1.0.0' },
      apps: [StreamTeardownApp],
    });
    handler = createWebFetchHandler(instance.getScopes()[0] as Scope);
  });

  afterAll(async () => {
    await instance?.shutdown();
  });

  it('settles the waitUntil teardown once the streamed reply has been read', async () => {
    const { ctx, pending } = recordingCtx();

    const response = await handler(streamedInitialize(), ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('"serverInfo"');
    expect(pending).toHaveLength(1);
    expect(await settles(pending[0])).toBe(true);
  });

  it('settles the waitUntil teardown when the client cancels the stream', async () => {
    const { ctx, pending } = recordingCtx();

    const response = await handler(streamedInitialize(), ctx);
    await response.body?.cancel();

    expect(pending).toHaveLength(1);
    expect(await settles(pending[0])).toBe(true);
  });

  it('answers a standalone GET stream with 405 instead of a stream no request can write to', async () => {
    const { ctx, pending } = recordingCtx();

    const response = await handler(new Request(WORKER_URL, { headers: { accept: 'text/event-stream' } }), ctx);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, DELETE');
    expect(pending).toHaveLength(0);
  });
});
