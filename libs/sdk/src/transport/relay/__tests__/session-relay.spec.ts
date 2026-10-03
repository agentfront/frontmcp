import type { ServerRequest, ServerResponse } from '../../../common';
import { SessionOwnerUnreachableError } from '../../../errors/transport.errors';
import type { HaRelayMessage, RelayedHttpRequest, ResponseRelayMessage } from '../../../ha/relay-messages';
import { relayedFrom } from '../relay-http';
import { SessionRelay, type RelayResponseTarget, type SessionRelayOptions } from '../session-relay';

/** In-memory pub/sub between relays, delivering each message on a later tick (like Redis). */
function createBroker() {
  const nodes = new Map<string, SessionRelay>();
  const published: Array<{ to: string; message: HaRelayMessage }> = [];
  const publish =
    (from: string) =>
    async (to: string, message: HaRelayMessage): Promise<number> => {
      published.push({ to, message });
      const target = nodes.get(to);
      if (!target) return 0;
      setImmediate(() => target.handleMessage(JSON.parse(JSON.stringify(message)) as HaRelayMessage));
      void from;
      return 1;
    };
  return { nodes, published, publish };
}

/** A client-facing response on the relaying node. */
function createTarget() {
  const listeners: Array<() => void> = [];
  const target = {
    headersSent: false,
    writableEnded: false,
    writableFinished: false,
    status: 0,
    headers: {} as Record<string, string | string[]>,
    chunks: [] as Array<Uint8Array | string>,
    writeHead: jest.fn((status: number, headers: Record<string, string | string[]>) => {
      target.status = status;
      target.headers = headers;
      target.headersSent = true;
    }),
    flushHeaders: jest.fn(),
    write: jest.fn((chunk: Uint8Array | string) => {
      target.headersSent = true;
      target.chunks.push(chunk);
    }),
    end: jest.fn(() => {
      target.headersSent = true;
      target.writableEnded = true;
      target.writableFinished = true;
    }),
    once: jest.fn((_event: 'close', listener: () => void) => listeners.push(listener)),
    removeListener: jest.fn((_event: 'close', listener: () => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }),
    /** The client went away. */
    close: () => [...listeners].forEach((listener) => listener()),
    text: () => target.chunks.map((c) => (typeof c === 'string' ? c : new TextDecoder().decode(c))).join(''),
  };
  return target;
}

function request(overrides: Partial<RelayedHttpRequest> = {}): RelayedHttpRequest {
  return {
    method: 'POST',
    url: '/',
    path: '/',
    headers: { host: 'localhost', 'mcp-session-id': 'sess-1' },
    query: {},
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('SessionRelay', () => {
  let broker: ReturnType<typeof createBroker>;

  function createRelay(nodeId: string, options: Partial<SessionRelayOptions> = {}): SessionRelay {
    const relay = new SessionRelay({
      nodeId,
      publish: broker.publish(nodeId),
      isNodeAlive: async () => true,
      serve: async (_req, res) => {
        res.status(200).json({ ok: true });
      },
      ...options,
    });
    broker.nodes.set(nodeId, relay);
    return relay;
  }

  beforeEach(() => {
    broker = createBroker();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("streams the owner's response back to the relaying node's client", async () => {
    const serve = jest.fn(async (req: ServerRequest, res: ServerResponse) => {
      expect(relayedFrom(req)).toBe('node-b');
      expect(req.body).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
      res.write('event: message\n');
      res.write(new TextEncoder().encode('data: {"ok":true}\n\n'));
      res.end();
    });
    const owner = createRelay('node-a', { serve });
    const relaying = createRelay('node-b');
    const target = createTarget();

    await relaying.forward('node-a', 'sess-1', request(), target);

    expect(serve).toHaveBeenCalledTimes(1);
    expect(target.status).toBe(200);
    expect(target.headers).toEqual({ 'content-type': 'text/event-stream' });
    expect(target.flushHeaders).toHaveBeenCalled();
    expect(target.text()).toBe('event: message\ndata: {"ok":true}\n\n');
    expect(target.end).toHaveBeenCalledTimes(1);
    expect(relaying.pendingCount).toBe(0);
    expect(owner.servingCount).toBe(0);
    expect(target.removeListener).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('fails with a retryable 503 when the owner does not listen', async () => {
    const relaying = createRelay('node-b', { retryAfterSeconds: 12 });
    const target = createTarget();

    const error = await relaying.forward('node-gone', 'sess-1', request(), target).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SessionOwnerUnreachableError);
    expect((error as SessionOwnerUnreachableError).statusCode).toBe(503);
    expect((error as SessionOwnerUnreachableError).retryAfterSeconds).toBe(12);
    expect((error as SessionOwnerUnreachableError).ownerNodeId).toBe('node-gone');
    expect((error as SessionOwnerUnreachableError).reason).toContain('does not listen');
    expect(target.writeHead).not.toHaveBeenCalled();
    expect(relaying.pendingCount).toBe(0);
  });

  it('fails when publishing the request fails', async () => {
    const relaying = new SessionRelay({
      nodeId: 'node-b',
      publish: async () => {
        throw new Error('redis down');
      },
      isNodeAlive: async () => true,
      serve: jest.fn(),
    });

    const error = await relaying.forward('node-a', 'sess-1', request(), createTarget()).catch((e: unknown) => e);
    expect((error as SessionOwnerUnreachableError).reason).toContain('redis down');
  });

  it('fails when the owner does not acknowledge in time', async () => {
    jest.useFakeTimers();
    const logger = { info: jest.fn(), warn: jest.fn(), verbose: jest.fn() };
    const relaying = new SessionRelay({
      nodeId: 'node-b',
      publish: async () => 1, // someone listens, nobody answers
      isNodeAlive: async () => true,
      serve: jest.fn(),
      ackTimeoutMs: 1000,
      logger,
    });

    const outcome = relaying.forward('node-a', 'sess-1', request(), createTarget()).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1000);

    expect(((await outcome) as SessionOwnerUnreachableError).reason).toContain('did not acknowledge');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Relay to session owner failed'), {
      sessionId: 'sess-1',
      ownerNodeId: 'node-a',
    });
    expect(logger.verbose).toHaveBeenCalled();
  });

  describe('when the owner stops while serving', () => {
    function hangingOwner(writeHead: boolean) {
      let release: () => void = () => undefined;
      const serve = jest.fn(
        (_req: ServerRequest, res: ServerResponse) =>
          new Promise<void>((resolve) => {
            if (writeHead) {
              res.writeHead(200, { 'content-type': 'text/event-stream' });
              res.write('partial');
            }
            release = resolve;
          }),
      );
      return { serve, release: () => release() };
    }

    it('fails before anything reached the client', async () => {
      jest.useFakeTimers();
      const owner = hangingOwner(false);
      createRelay('node-a', { serve: owner.serve });
      let alive = true;
      const relaying = createRelay('node-b', { isNodeAlive: async () => alive, ownerCheckIntervalMs: 500 });

      const outcome = relaying.forward('node-a', 'sess-1', request(), createTarget()).catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(10);
      await jest.advanceTimersByTimeAsync(500);
      alive = false;
      await jest.advanceTimersByTimeAsync(500);

      expect(((await outcome) as SessionOwnerUnreachableError).reason).toContain('stopped');
      owner.release();
    });

    it('ends a response that already started', async () => {
      jest.useFakeTimers();
      const owner = hangingOwner(true);
      createRelay('node-a', { serve: owner.serve });
      let alive = true;
      const relaying = createRelay('node-b', { isNodeAlive: async () => alive, ownerCheckIntervalMs: 500 });
      const target = createTarget();

      const outcome = relaying.forward('node-a', 'sess-1', request(), target);
      await jest.advanceTimersByTimeAsync(10);
      expect(target.text()).toBe('partial');
      alive = false;
      await jest.advanceTimersByTimeAsync(500);

      await expect(outcome).resolves.toBeUndefined();
      expect(target.end).toHaveBeenCalledTimes(1);
      owner.release();
    });

    it('keeps waiting while the heartbeat cannot be read', async () => {
      jest.useFakeTimers();
      const owner = hangingOwner(false);
      createRelay('node-a', { serve: owner.serve });
      const relaying = createRelay('node-b', {
        isNodeAlive: async () => {
          throw new Error('redis hiccup');
        },
        ownerCheckIntervalMs: 500,
      });

      let settled = false;
      const outcome = relaying.forward('node-a', 'sess-1', request(), createTarget()).finally(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(10);
      await jest.advanceTimersByTimeAsync(2000);
      expect(settled).toBe(false);

      owner.release();
      await jest.advanceTimersByTimeAsync(10);
      await outcome;
      expect(settled).toBe(true);
    });
  });

  it('cancels the request on the owner when the client goes away', async () => {
    let ownerResponse: ServerResponse | undefined;
    const closed = jest.fn();
    let release: () => void = () => undefined;
    const owner = createRelay('node-a', {
      serve: (_req, res) =>
        new Promise<void>((resolve) => {
          ownerResponse = res;
          res.on('close', closed);
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          release = resolve;
        }),
    });
    const relaying = createRelay('node-b');
    const target = createTarget();

    const outcome = relaying.forward('node-a', 'sess-1', request({ method: 'GET', body: undefined }), target);
    await flush();
    await flush();
    expect(owner.servingCount).toBe(1);

    target.close();
    await outcome;
    await flush();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(ownerResponse?.writableFinished).toBe(false);
    expect(broker.published.some((p) => p.to === 'node-a' && p.message.kind === 'relay-cancel')).toBe(true);
    release();
    await flush();
    expect(owner.servingCount).toBe(0);
  });

  it('ignores a client close after the response finished', async () => {
    createRelay('node-a');
    const relaying = createRelay('node-b');
    const target = createTarget();
    await relaying.forward('node-a', 'sess-1', request(), target);
    target.close();
    expect(broker.published.some((p) => p.message.kind === 'relay-cancel')).toBe(false);
  });

  it('fails when the owner reports an error before the response started, or ends a started one', async () => {
    const relaying = createRelay('node-b');
    broker.nodes.set('node-a', {
      handleMessage: (message: HaRelayMessage) => {
        if (message.kind !== 'relay-request') return;
        const reply = (event: Record<string, unknown>) =>
          relaying.handleMessage({
            kind: 'relay-response',
            requestId: message.requestId,
            sourceNodeId: 'node-a',
            ...event,
          } as ResponseRelayMessage);
        reply({ event: 'ack' });
        if (message.request.method === 'PUT') reply({ event: 'head', status: 200, headers: {} });
        reply({ event: 'error', message: 'boom' });
      },
    } as unknown as SessionRelay);

    const error = await relaying.forward('node-a', 'sess-1', request(), createTarget()).catch((e: unknown) => e);
    expect((error as SessionOwnerUnreachableError).reason).toContain('boom');

    const started = createTarget();
    await expect(relaying.forward('node-a', 'sess-1', request({ method: 'PUT' }), started)).resolves.toBeUndefined();
    expect(started.end).toHaveBeenCalled();
  });

  it('drops frames from another node, for unknown requests, and cancels from another node', async () => {
    const relaying = createRelay('node-b');
    const target = createTarget();
    broker.nodes.set('node-a', {
      handleMessage: (message: HaRelayMessage) => {
        if (message.kind !== 'relay-request') return;
        // A frame claiming to come from another node is ignored.
        relaying.handleMessage({
          kind: 'relay-response',
          requestId: message.requestId,
          sourceNodeId: 'node-x',
          event: 'end',
        });
        relaying.handleMessage({ kind: 'relay-response', requestId: 'unknown', sourceNodeId: 'node-a', event: 'end' });
        for (const event of [{ event: 'head', status: 204, headers: {} }, { event: 'end' }] as const) {
          relaying.handleMessage({
            kind: 'relay-response',
            requestId: message.requestId,
            sourceNodeId: 'node-a',
            ...event,
          } as ResponseRelayMessage);
        }
      },
    } as unknown as SessionRelay);

    await relaying.forward('node-a', 'sess-1', request(), target);
    expect(target.status).toBe(204);

    // Unrelated messages are ignored.
    relaying.handleMessage({ kind: 'relay-cancel', requestId: 'nope', sourceNodeId: 'node-a' });
    relaying.handleMessage({
      kind: 'destroy-session',
      sessionId: 's',
      sourceNodeId: 'node-a',
      timestamp: 0,
    });
  });

  it('does not let another node cancel a request it did not relay', async () => {
    const closed = jest.fn();
    let release: () => void = () => undefined;
    const owner = createRelay('node-a', {
      serve: (_req, res) =>
        new Promise<void>((resolve) => {
          res.on('close', closed);
          release = () => {
            res.end();
            resolve();
          };
        }),
    });
    const relaying = createRelay('node-b');
    const outcome = relaying.forward('node-a', 'sess-1', request(), createTarget());
    await flush();
    await flush();

    const requestId = (
      broker.published.find((p) => p.message.kind === 'relay-request')?.message as { requestId: string }
    ).requestId;
    owner.handleMessage({ kind: 'relay-cancel', requestId, sourceNodeId: 'node-x' });
    expect(closed).not.toHaveBeenCalled();

    release();
    await outcome;
  });

  describe('serving a relayed request', () => {
    it('answers 500 when serving throws before writing', async () => {
      const logger = { info: jest.fn(), warn: jest.fn() };
      createRelay('node-a', {
        serve: async () => {
          throw new Error('flow exploded');
        },
        logger,
      });
      const relaying = createRelay('node-b');
      const target = createTarget();

      await relaying.forward('node-a', 'sess-1', request(), target);

      expect(target.status).toBe(500);
      expect(target.text()).toContain('Internal error');
      expect(logger.warn).toHaveBeenCalledWith('[HA] Serving a relayed request failed', expect.any(Object));
    });

    it('ends a started response when serving throws', async () => {
      createRelay('node-a', {
        serve: async (_req, res) => {
          res.writeHead(200, {});
          res.write('half');
          throw new Error('late failure');
        },
      });
      const relaying = createRelay('node-b');
      const target = createTarget();

      await relaying.forward('node-a', 'sess-1', request(), target);
      expect(target.text()).toBe('half');
      expect(target.end).toHaveBeenCalled();
    });

    it('ends a response the flow left open', async () => {
      createRelay('node-a', {
        serve: async (_req, res) => {
          res.writeHead(202, {});
        },
      });
      const relaying = createRelay('node-b');
      const target = createTarget();

      await relaying.forward('node-a', 'sess-1', request(), target);
      expect(target.status).toBe(202);
      expect(target.end).toHaveBeenCalled();
    });

    it('logs a response frame that cannot be published', async () => {
      const logger = { info: jest.fn(), warn: jest.fn() };
      const owner = new SessionRelay({
        nodeId: 'node-a',
        publish: async () => {
          throw new Error('publish failed');
        },
        isNodeAlive: async () => true,
        serve: async (_req, res) => {
          res.end();
        },
        logger,
      });
      owner.handleMessage({
        kind: 'relay-request',
        requestId: 'r1',
        sourceNodeId: 'node-b',
        sessionId: 'sess-1',
        request: request(),
        timestamp: Date.now(),
      });
      await flush();
      expect(logger.warn).toHaveBeenCalledWith('[HA] Failed to publish a relayed response frame', expect.any(Object));
    });
  });

  describe('when response frames cannot be delivered', () => {
    function streamingOwner() {
      const closed = jest.fn();
      const serve = jest.fn(
        (_req: ServerRequest, res: ServerResponse) =>
          new Promise<void>((resolve) => {
            res.on('close', () => {
              closed();
              resolve();
            });
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write('first');
          }),
      );
      return { serve, closed };
    }

    function ownerPublishing(decide: (message: HaRelayMessage) => 'deliver' | 'reject' | 'nobody' | 'drop') {
      const deliver = broker.publish('node-a');
      return async (to: string, message: HaRelayMessage): Promise<number> => {
        switch (decide(message)) {
          case 'reject':
            throw new Error('redis down');
          case 'nobody':
            return 0;
          case 'drop':
            return 1;
          default:
            return deliver(to, message);
        }
      };
    }

    const isFrame = (message: HaRelayMessage, event: string) =>
      message.kind === 'relay-response' && message.event === event;

    it('aborts the response on the owner and ends it on the relaying node when a frame fails to publish', async () => {
      const owner = streamingOwner();
      const relayingOwner = createRelay('node-a', {
        serve: owner.serve,
        publish: ownerPublishing((message) => (isFrame(message, 'data') ? 'reject' : 'deliver')),
      });
      const relaying = createRelay('node-b');
      const target = createTarget();

      let settled = false;
      const outcome = relaying.forward('node-a', 'sess-1', request(), target).finally(() => {
        settled = true;
      });
      for (let i = 0; i < 5; i++) await flush();

      expect(settled).toBe(true);
      await outcome;
      expect(target.status).toBe(200);
      expect(target.end).toHaveBeenCalledTimes(1);
      expect(owner.closed).toHaveBeenCalledTimes(1);
      expect(relaying.pendingCount).toBe(0);
      expect(relayingOwner.servingCount).toBe(0);
    });

    it('aborts the response on the owner when the relaying node no longer listens', async () => {
      const owner = streamingOwner();
      const logger = { info: jest.fn(), warn: jest.fn() };
      const relayingOwner = createRelay('node-a', {
        serve: owner.serve,
        publish: ownerPublishing((message) => (isFrame(message, 'data') ? 'nobody' : 'deliver')),
        logger,
      });
      createRelay('node-b');
      relayingOwner.handleMessage({
        kind: 'relay-request',
        requestId: 'r1',
        sourceNodeId: 'node-b',
        sessionId: 'sess-1',
        request: request(),
        timestamp: Date.now(),
      });
      for (let i = 0; i < 3; i++) await flush();

      expect(owner.closed).toHaveBeenCalledTimes(1);
      expect(relayingOwner.servingCount).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith('[HA] Failed to publish a relayed response frame', {
        reason: 'the relaying node no longer listens',
        targetNodeId: 'node-b',
      });
    });

    it('ends a relayed response whose frames stop arriving, even though the owner is alive', async () => {
      jest.useFakeTimers();
      const owner = streamingOwner();
      let lost = false;
      createRelay('node-a', {
        serve: owner.serve,
        publish: ownerPublishing((message) => {
          if (isFrame(message, 'data')) lost = true;
          return lost && message.kind === 'relay-response' && message.event !== 'data' ? 'drop' : 'deliver';
        }),
      });
      const relaying = createRelay('node-b', { ownerCheckIntervalMs: 500 });
      const target = createTarget();

      let settled = false;
      const outcome = relaying.forward('node-a', 'sess-1', request(), target).finally(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(10);
      expect(target.text()).toBe('first');

      await jest.advanceTimersByTimeAsync(1000);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1000);

      expect(settled).toBe(true);
      await outcome;
      expect(target.end).toHaveBeenCalledTimes(1);
      expect(relaying.pendingCount).toBe(0);
    });

    it('keeps a quiet stream open while the owner sends keepalives', async () => {
      jest.useFakeTimers();
      const owner = streamingOwner();
      const ownerRelay = createRelay('node-a', { serve: owner.serve });
      const relaying = createRelay('node-b', { ownerCheckIntervalMs: 500 });
      const target = createTarget();

      let settled = false;
      const outcome = relaying.forward('node-a', 'sess-1', request(), target).finally(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(5000);

      expect(settled).toBe(false);
      expect(broker.published.filter((p) => isFrame(p.message, 'keepalive')).length).toBeGreaterThanOrEqual(9);

      target.close();
      await outcome;
      await jest.advanceTimersByTimeAsync(10);
      expect(ownerRelay.servingCount).toBe(0);
    });
  });

  it('drops a malformed relayed request', async () => {
    const serve = jest.fn();
    const publish = jest.fn(async () => 1);
    const logger = { info: jest.fn(), warn: jest.fn() };
    const owner = new SessionRelay({ nodeId: 'node-a', publish, isNodeAlive: async () => true, serve, logger });
    const malformed = [
      { sessionId: 42, request: request() },
      { sessionId: 'sess-1', request: null },
      { sessionId: 'sess-1', request: request(), requestId: 7 },
    ];

    for (const fields of malformed) {
      owner.handleMessage({
        kind: 'relay-request',
        requestId: 'r1',
        sourceNodeId: 'node-b',
        timestamp: Date.now(),
        ...fields,
      } as unknown as HaRelayMessage);
    }
    await flush();

    expect(serve).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith('[HA] Dropped a malformed relayed request');
  });

  describe('close()', () => {
    it('fails requests in flight, aborts requests being served, and refuses new ones', async () => {
      let release: () => void = () => undefined;
      const ownerClosed = jest.fn();
      const owner = createRelay('node-a', {
        serve: (_req, res) =>
          new Promise<void>((resolve) => {
            res.on('close', ownerClosed);
            release = resolve;
          }),
      });
      const relaying = createRelay('node-b');
      const target = createTarget();

      const outcome = relaying.forward('node-a', 'sess-1', request(), target).catch((e: unknown) => e);
      await flush();
      await flush();
      expect(owner.servingCount).toBe(1);

      await owner.close();
      await owner.close();
      expect(ownerClosed).toHaveBeenCalled();
      expect(owner.servingCount).toBe(0);
      // node-b learns the owner is shutting down
      expect(((await outcome) as SessionOwnerUnreachableError).reason).toContain('shutting down');
      release();

      // A request reaching a closed owner is refused.
      const refused = await relaying.forward('node-a', 'sess-2', request(), createTarget()).catch((e: unknown) => e);
      expect((refused as SessionOwnerUnreachableError).reason).toContain('shutting down');

      await relaying.close();
      await expect(relaying.forward('node-a', 'sess-3', request(), createTarget())).rejects.toBeInstanceOf(
        SessionOwnerUnreachableError,
      );
    });

    it('fails the requests this node relayed', async () => {
      const relaying = new SessionRelay({
        nodeId: 'node-b',
        publish: async () => 1,
        isNodeAlive: async () => true,
        serve: jest.fn(),
      });
      const outcome = relaying.forward('node-a', 'sess-1', request(), createTarget()).catch((e: unknown) => e);
      await relaying.close();
      expect(await outcome).toBeInstanceOf(SessionOwnerUnreachableError);
      expect(relaying.pendingCount).toBe(0);
    });
  });

  it('uses defaults for the timings', () => {
    const relay = new SessionRelay({
      nodeId: 'node-a',
      publish: async () => 1,
      isNodeAlive: async () => true,
      serve: jest.fn(),
    });
    expect(relay.unreachable('node-b', 'x').retryAfterSeconds).toBe(30);
  });
});

// Keep the structural target type honest against Node's response.
const _typecheck: RelayResponseTarget = {} as ServerResponse;
void _typecheck;
