import { createBridgeStateMachine, type BridgeStateMachine } from '../state-machine';
import type { JsonRpcFrame } from '../stdio-framer';

function makeLog() {
  return {
    path: undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    reloadEvent: () => undefined,
    close: async () => undefined,
  };
}

interface Recorder {
  forwarded: JsonRpcFrame[];
  responses: JsonRpcFrame[];
  forwardError?: Error;
}

function makeFsm(opts: { bufferSize?: number; reloadDeadlineMs?: number; forwardError?: Error } = {}): {
  fsm: BridgeStateMachine;
  rec: Recorder;
} {
  const rec: Recorder = { forwarded: [], responses: [] };
  if (opts.forwardError) rec.forwardError = opts.forwardError;
  const fsm = createBridgeStateMachine({
    log: makeLog(),
    bufferSize: opts.bufferSize ?? 8,
    reloadDeadlineMs: opts.reloadDeadlineMs ?? 30_000,
    respond: (f) => {
      rec.responses.push(f);
    },
    forward: async (f) => {
      if (rec.forwardError) throw rec.forwardError;
      rec.forwarded.push(f);
    },
  });
  return { fsm, rec };
}

describe('bridge state machine (issue #399)', () => {
  it('starts in Idle and buffers inbound frames before the child is ready', async () => {
    const { fsm, rec } = makeFsm();
    expect(fsm.state).toBe('Idle');
    await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(rec.forwarded).toHaveLength(0);
    expect(fsm.bufferDepth()).toBe(1);
  });

  it('Booting → Ready drains buffered requests in FIFO', async () => {
    const { fsm, rec } = makeFsm();
    fsm.onBootStart();
    expect(fsm.state).toBe('Booting');
    await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'a' });
    await fsm.enqueue({ jsonrpc: '2.0', id: 2, method: 'b' });
    await fsm.enqueue({ jsonrpc: '2.0', id: 3, method: 'c' });
    expect(fsm.bufferDepth()).toBe(3);

    fsm.onChildReady();
    await new Promise((r) => setImmediate(r));
    expect(fsm.state).toBe('Ready');
    expect(rec.forwarded.map((f) => f.id)).toEqual([1, 2, 3]);
  });

  it('Ready → Reloading on watcher event; inflight requests get dev_server_unreachable', async () => {
    const { fsm, rec } = makeFsm();
    fsm.onBootStart();
    fsm.onChildReady();
    await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'long-call' });
    // The request is now forwarded and tracked as inflight.

    fsm.onWatcherEvent('src/foo.ts');
    expect(fsm.state).toBe('Reloading');
    await new Promise((r) => setImmediate(r));
    const respondedFail = rec.responses.find((r) => r.id === 1 && r.error?.code === -32099);
    expect(respondedFail).toBeDefined();
    expect(respondedFail?.error?.data).toMatchObject({ reason: 'reload' });
  });

  it('buffers requests during Reloading and drains them on next Ready', async () => {
    const { fsm, rec } = makeFsm();
    fsm.onBootStart();
    fsm.onChildReady();
    fsm.onWatcherEvent('src/foo.ts');
    await fsm.enqueue({ jsonrpc: '2.0', id: 9, method: 'queued' });
    expect(rec.forwarded).toHaveLength(0);
    expect(fsm.bufferDepth()).toBe(1);
    fsm.onChildReady();
    await new Promise((r) => setImmediate(r));
    expect(rec.forwarded.map((f) => f.id)).toEqual([9]);
  });

  it('buffer overflow responds with -32098 dev_buffer_full', async () => {
    const { fsm, rec } = makeFsm({ bufferSize: 2 });
    fsm.onBootStart(); // Booting — frames buffer
    await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'a' });
    await fsm.enqueue({ jsonrpc: '2.0', id: 2, method: 'b' });
    await fsm.enqueue({ jsonrpc: '2.0', id: 3, method: 'c' });
    const overflow = rec.responses.find((r) => r.error?.code === -32098);
    expect(overflow).toBeDefined();
    expect(overflow?.id).toBe(3);
  });

  it('Reloading → Degraded when the reload deadline elapses; buffered requests get -32097', async () => {
    jest.useFakeTimers();
    try {
      const { fsm, rec } = makeFsm({ reloadDeadlineMs: 1000 });
      fsm.onBootStart();
      fsm.onChildReady();
      fsm.onWatcherEvent('src/foo.ts');
      await fsm.enqueue({ jsonrpc: '2.0', id: 5, method: 'wait' });
      jest.advanceTimersByTime(1500);
      await Promise.resolve(); // let pending micro-tasks settle
      expect(fsm.state).toBe('Degraded');
      const deadlineFail = rec.responses.find((r) => r.id === 5 && r.error?.code === -32097);
      expect(deadlineFail).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('relayUpstream clears inflight tracking and forwards to client', async () => {
    const { fsm, rec } = makeFsm();
    fsm.onBootStart();
    fsm.onChildReady();
    await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await fsm.relayUpstream({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    const upstreamResponse = rec.responses.find((r) => r.id === 1 && r.result !== undefined);
    expect(upstreamResponse).toBeDefined();
  });

  it('stop() flushes inflight + buffered with dev_server_unreachable', async () => {
    const { fsm, rec } = makeFsm();
    fsm.onBootStart();
    fsm.onChildReady();
    await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'inflight' });
    // Now in Ready with id=1 inflight; transition to Reloading then stop
    fsm.onWatcherEvent('src/foo.ts');
    await fsm.enqueue({ jsonrpc: '2.0', id: 2, method: 'buffered' });
    await fsm.stop();
    expect(fsm.state).toBe('Stopping');
    // Both ids should have received an error response by now
    expect(rec.responses.some((r) => r.id === 1 && r.error)).toBe(true);
    expect(rec.responses.some((r) => r.id === 2 && r.error)).toBe(true);
  });

  it('Degraded → returns dev_server_unreachable immediately for new inbound requests', async () => {
    jest.useFakeTimers();
    try {
      const { fsm, rec } = makeFsm({ reloadDeadlineMs: 100 });
      fsm.onBootStart();
      fsm.onChildReady();
      fsm.onWatcherEvent('src/foo.ts');
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      expect(fsm.state).toBe('Degraded');
      rec.responses.length = 0;
      await fsm.enqueue({ jsonrpc: '2.0', id: 42, method: 'still-trying' });
      expect(rec.responses.find((r) => r.id === 42 && r.error?.code === -32099)).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops notifications (no id) silently when buffer is full', async () => {
    const { fsm, rec } = makeFsm({ bufferSize: 1 });
    fsm.onBootStart();
    await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'req' });
    await fsm.enqueue({ jsonrpc: '2.0', method: 'notify' }); // no id
    // No error response for the notification — would be invalid per spec
    expect(rec.responses.find((r) => r.error)).toBeUndefined();
  });

  it('synthesises dev_server_unreachable when forward() throws', async () => {
    const { fsm, rec } = makeFsm({ forwardError: new Error('connection refused') });
    fsm.onBootStart();
    fsm.onChildReady();
    await fsm.enqueue({ jsonrpc: '2.0', id: 11, method: 'send' });
    const failResp = rec.responses.find((r) => r.id === 11 && r.error?.code === -32099);
    expect(failResp).toBeDefined();
    expect(failResp?.error?.data).toMatchObject({ reason: 'forward_failed' });
  });

  // Lock the contract: calling `onReloadDeadline()` directly (not via the
  // internal timer) must flush buffered requests with -32097 dev_reload_deadline,
  // NOT -32099 dev_server_unreachable. The two map to distinct public errors
  // so clients can distinguish "watcher reload took too long" from "child died".
  it('onReloadDeadline() flushes buffered requests with -32097 dev_reload_deadline (not -32099)', async () => {
    const { fsm, rec } = makeFsm({ reloadDeadlineMs: 1000 });
    fsm.onBootStart();
    fsm.onChildReady();
    fsm.onWatcherEvent('src/foo.ts');
    await fsm.enqueue({ jsonrpc: '2.0', id: 5, method: 'wait' });
    expect(fsm.bufferDepth()).toBe(1);

    fsm.onReloadDeadline();
    // Allow the async flushBufferAsResponses to drain.
    await new Promise((r) => setImmediate(r));

    expect(fsm.state).toBe('Degraded');
    const flushed = rec.responses.find((r) => r.id === 5);
    expect(flushed).toBeDefined();
    expect(flushed?.error?.code).toBe(-32097);
    expect(flushed?.error?.data).toMatchObject({ reason: 'deadline', deadlineMs: 1000 });
  });

  it('adds the detail it is given to every flushed error', async () => {
    const { fsm, rec } = makeFsm({ reloadDeadlineMs: 1000 });
    fsm.onBootStart();
    await fsm.enqueue({ jsonrpc: '2.0', id: 6, method: 'initialize' });

    fsm.onReloadDeadline({ error: 'the server listens on a Unix socket' });
    await new Promise((r) => setImmediate(r));

    expect(rec.responses.find((r) => r.id === 6)?.error?.data).toMatchObject({
      reason: 'deadline',
      error: 'the server listens on a Unix socket',
    });
  });

  it('keeps the boot-failure detail for requests that arrive after the deadline', async () => {
    const { fsm, rec } = makeFsm({ reloadDeadlineMs: 1000 });
    fsm.onBootStart();
    fsm.onReloadDeadline({ error: 'the server listens on a Unix socket' });

    await fsm.enqueue({ jsonrpc: '2.0', id: 7, method: 'initialize' });

    expect(rec.responses.find((r) => r.id === 7)?.error?.data).toMatchObject({
      reason: 'degraded',
      error: 'the server listens on a Unix socket',
    });
  });

  it('drops the boot-failure detail once a child becomes ready', async () => {
    const { fsm, rec } = makeFsm({ reloadDeadlineMs: 1000 });
    fsm.onBootStart();
    fsm.onReloadDeadline({ error: 'the server listens on a Unix socket' });
    fsm.onChildReady();
    fsm.onChildExit('crashed');
    fsm.onReloadDeadline();

    await fsm.enqueue({ jsonrpc: '2.0', id: 8, method: 'tools/list' });

    expect(rec.responses.find((r) => r.id === 8)?.error?.data).not.toHaveProperty('error');
  });

  // Lock the contract: when forward() throws during the buffered-drain pass
  // on `onChildReady`, the request must still get a synthesized error
  // response — silently dropping it would leave the client hanging.
  it('synthesises dev_server_unreachable when forward() throws during drain', async () => {
    const { fsm, rec } = makeFsm({ forwardError: new Error('drained-into-failure') });
    fsm.onBootStart();
    // Buffer a request while not-Ready.
    await fsm.enqueue({ jsonrpc: '2.0', id: 99, method: 'queued' });
    expect(fsm.bufferDepth()).toBe(1);

    fsm.onChildReady();
    // The async drain runs after onChildReady returns — give it one tick
    // to flush so the synthesised error response lands in `rec`.
    await new Promise((r) => setImmediate(r));

    expect(fsm.bufferDepth()).toBe(0);
    const failResp = rec.responses.find((r) => r.id === 99 && r.error?.code === -32099);
    expect(failResp).toBeDefined();
    expect(failResp?.error?.data).toMatchObject({ reason: 'forward_failed' });
  });

  describe('when its upstream is lost', () => {
    it('buffers new requests and leaves the ones in flight to settle on their own', async () => {
      const { fsm, rec } = makeFsm();
      fsm.onBootStart();
      fsm.onChildReady();
      await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'long-call' });

      fsm.onUpstreamLost('drained');
      await fsm.enqueue({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      await new Promise((r) => setImmediate(r));

      expect(fsm.state).toBe('Reloading');
      expect(rec.responses).toEqual([]);
      expect(fsm.bufferDepth()).toBe(1);
      await fsm.relayUpstream({ jsonrpc: '2.0', id: 1, result: {} });
      fsm.onChildReady();
      await new Promise((r) => setImmediate(r));
      expect(rec.responses.map((r) => r.id)).toEqual([1]);
      expect(rec.forwarded.map((f) => f.id)).toEqual([1, 2]);
    });

    it('puts a request its upstream never took back in front of the buffer, and sends it once ready', async () => {
      const { fsm, rec } = makeFsm();
      fsm.onBootStart();
      fsm.onChildReady();
      const refused: JsonRpcFrame = { jsonrpc: '2.0', id: 1, method: 'tools/call' };
      await fsm.enqueue(refused);
      fsm.onUpstreamLost('drained');
      await fsm.enqueue({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

      await fsm.requeue(refused);
      expect(fsm.bufferDepth()).toBe(2);
      fsm.onChildReady();
      await new Promise((r) => setImmediate(r));

      expect(rec.forwarded.map((f) => f.id)).toEqual([1, 1, 2]);
      expect(rec.responses).toEqual([]);
    });

    it('sends a requeued request at once when it is ready again', async () => {
      const { fsm, rec } = makeFsm();
      fsm.onBootStart();
      fsm.onChildReady();
      const frame: JsonRpcFrame = { jsonrpc: '2.0', id: 3, method: 'tools/call' };
      await fsm.requeue(frame);
      expect(rec.forwarded.map((f) => f.id)).toEqual([3]);
    });

    it('keeps the buffered requests a drain had not sent yet, instead of dropping them', async () => {
      const rec: Recorder = { forwarded: [], responses: [] };
      let release: () => void = () => undefined;
      const fsm = createBridgeStateMachine({
        log: makeLog(),
        bufferSize: 8,
        reloadDeadlineMs: 30_000,
        respond: (f) => void rec.responses.push(f),
        forward: async (f) => {
          rec.forwarded.push(f);
          if (f.id === 1) await new Promise<void>((resolve) => (release = resolve));
        },
      });
      fsm.onBootStart();
      for (const id of [1, 2, 3]) await fsm.enqueue({ jsonrpc: '2.0', id, method: 'm' });
      fsm.onChildReady();
      await new Promise((r) => setImmediate(r));

      fsm.onUpstreamLost('drained');
      release();
      await new Promise((r) => setImmediate(r));
      expect(fsm.bufferDepth()).toBe(2);
      fsm.onChildReady();
      await new Promise((r) => setImmediate(r));

      expect(rec.forwarded.map((f) => f.id)).toEqual([1, 2, 3]);
      expect(rec.responses).toEqual([]);
    });

    it('answers the requests a drain had not sent yet when it stops', async () => {
      const rec: Recorder = { forwarded: [], responses: [] };
      let release: () => void = () => undefined;
      const fsm = createBridgeStateMachine({
        log: makeLog(),
        bufferSize: 8,
        reloadDeadlineMs: 30_000,
        respond: (f) => void rec.responses.push(f),
        forward: async (f) => {
          rec.forwarded.push(f);
          if (f.id === 1) await new Promise<void>((resolve) => (release = resolve));
        },
      });
      fsm.onBootStart();
      for (const id of [1, 2]) await fsm.enqueue({ jsonrpc: '2.0', id, method: 'm' });
      fsm.onChildReady();
      await new Promise((r) => setImmediate(r));

      await fsm.stop();
      release();
      await new Promise((r) => setImmediate(r));

      expect(rec.responses.map((r) => [r.id, r.error?.code])).toEqual([
        [1, -32099],
        [2, -32099],
      ]);
    });

    it('answers a request whose forward fails once its upstream was lost, which no one else answers', async () => {
      const rec: Recorder = { forwarded: [], responses: [] };
      const fsm: BridgeStateMachine = createBridgeStateMachine({
        log: makeLog(),
        bufferSize: 8,
        reloadDeadlineMs: 30_000,
        respond: (f) => void rec.responses.push(f),
        forward: async (f) => {
          rec.forwarded.push(f);
          fsm.onUpstreamLost('gone');
          throw new Error('gone');
        },
      });
      fsm.onBootStart();
      await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'buffered' });
      fsm.onChildReady();
      await new Promise((r) => setImmediate(r));
      fsm.onChildReady();
      await fsm.enqueue({ jsonrpc: '2.0', id: 2, method: 'live' });

      expect(rec.responses.map((r) => [r.id, r.error?.code])).toEqual([
        [1, -32099],
        [2, -32099],
      ]);
    });

    it('answers a request whose forward fails after a child exit only once', async () => {
      const rec: Recorder = { forwarded: [], responses: [] };
      const fsm: BridgeStateMachine = createBridgeStateMachine({
        log: makeLog(),
        bufferSize: 8,
        reloadDeadlineMs: 30_000,
        respond: (f) => void rec.responses.push(f),
        forward: async () => {
          fsm.onChildExit('crashed');
          await new Promise((r) => setImmediate(r));
          throw new Error('crashed');
        },
      });
      fsm.onBootStart();
      fsm.onChildReady();
      await fsm.enqueue({ jsonrpc: '2.0', id: 1, method: 'live' });

      expect(rec.responses.filter((r) => r.id === 1)).toHaveLength(1);
    });
  });
});
