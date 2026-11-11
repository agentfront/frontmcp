/**
 * The HTTP upstream relays the session's standalone notification stream: the `GET` a streamable-HTTP server
 * answers with what it sends on its own. Without it no channel event, `list_changed`, log line or resource update
 * reached the stdio client.
 */
import type { JsonRpcFrame } from '../stdio-framer';
import { createHttpUpstream, type HttpUpstreamClient } from '../upstream-client';
import { FakeMcpServer, recordingLog, settle } from './helpers/fake-mcp-server';

const TOKEN = 'Bearer shared-server-token';
const OPEN_WAIT_MS = 2_000;
const FIRST_REOPEN_DELAY_MS = 250;
const MAX_FAILED_OPENS = 5;
/** The waits before the second to the fifth open of a stream that fails from the start: 250, 500, 1000 and 2000 ms. */
const GIVE_UP_AFTER_MS = 3_750;

const initialize: JsonRpcFrame = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'spec', version: '0' } },
};

/** A Claude Code channel notification. */
function channelEvent(content: string): JsonRpcFrame {
  return { jsonrpc: '2.0', method: 'notifications/claude/channel', params: { content, meta: {} } };
}

describe('the notification stream of the HTTP upstream', () => {
  let server: FakeMcpServer;
  let log: ReturnType<typeof recordingLog>;
  let frames: JsonRpcFrame[];
  let onStreamLost: jest.Mock;
  let upstream: HttpUpstreamClient;

  beforeEach(() => {
    server = new FakeMcpServer();
    log = recordingLog();
    frames = [];
    onStreamLost = jest.fn();
    upstream = createHttpUpstream({
      url: 'http://localhost/mcp',
      headers: { authorization: TOKEN },
      fetch: server.fetch,
      log,
      onFrame: (frame) => void frames.push(frame),
      onNotificationStreamLost: onStreamLost,
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await upstream.close();
  });

  it('opens no stream before a session started', async () => {
    await upstream.send({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    await settle();

    expect(server.sent('GET')).toEqual([]);
  });

  it('opens the stream of the session initialize started, with the headers of its requests, and relays its frames', async () => {
    await upstream.send(initialize);
    await settle();

    expect(server.sent('GET')).toEqual([
      {
        method: 'GET',
        headers: { authorization: TOKEN, accept: 'text/event-stream', 'mcp-session-id': 'session-1' },
      },
    ]);

    server.streams[0].send(channelEvent('build finished'));
    server.streams[0].send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    await settle();

    expect(frames).toEqual([
      { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: server.capabilities } },
      channelEvent('build finished'),
      { jsonrpc: '2.0', method: 'notifications/tools/list_changed' },
    ]);
  });

  it('sends the next request of the session only once the server answered its stream', async () => {
    let answerStream: () => void = () => undefined;
    const holdOpen = server.openStream;
    server.openStream = (stream) => new Promise((resolve) => (answerStream = () => resolve(holdOpen(stream))));

    const initialized = upstream.send(initialize);
    await settle();
    expect(frames.map((frame) => frame.id)).toEqual([1]);
    const listed = upstream.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await settle();
    expect(server.postedFrames().map((frame) => frame.method)).toEqual(['initialize']);

    answerStream();
    await Promise.all([initialized, listed]);
    expect(server.postedFrames().map((frame) => frame.method)).toEqual(['initialize', 'tools/list']);
    expect(server.sent('POST')[1].headers['mcp-session-id']).toBe('session-1');
  });

  it('sends the next request after 2 s when the server does not answer the stream', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    server.openStream = () => new Promise<Response>(() => undefined);

    void upstream.send(initialize);
    await settle();
    void upstream.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await jest.advanceTimersByTimeAsync(OPEN_WAIT_MS - 1);
    expect(server.sent('POST')).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1);
    await settle();
    expect(server.postedFrames().map((frame) => frame.method)).toEqual(['initialize', 'tools/list']);
  });

  it('follows the session of a replayed initialize, and ends the stream of the session before', async () => {
    await upstream.send(initialize);
    await settle();
    await upstream.reinitialize(initialize, true);
    await settle();

    expect(server.streams.map((stream) => stream.sessionId)).toEqual(['session-1', 'session-2']);
    expect(server.streams[0].signal?.aborted).toBe(true);
    expect(server.streams[1].signal?.aborted).toBe(false);

    server.streams[1].send(channelEvent('after the restart'));
    await settle();
    expect(frames).toContainEqual(channelEvent('after the restart'));
  });

  it.each([
    ['close()', (client: HttpUpstreamClient) => client.close()],
    ['endSession()', (client: HttpUpstreamClient) => client.endSession()],
    ['leaveSession()', (client: HttpUpstreamClient) => client.leaveSession()],
  ])('ends the stream on %s, and does not open it again', async (_, end) => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    await upstream.send(initialize);
    await settle();

    await end(upstream);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(server.streams).toHaveLength(1);
    expect(server.streams[0].signal?.aborted).toBe(true);
  });

  it('reopens the stream after it drops, and stops once the session ended', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    await upstream.send(initialize);
    await settle();
    server.streams[0].send(channelEvent('before the drop'));
    await settle();

    server.streams[0].end();
    await settle();
    expect(server.streams).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(FIRST_REOPEN_DELAY_MS);
    expect(server.streams.map((stream) => stream.sessionId)).toEqual(['session-1', 'session-1']);

    server.streams[1].send(channelEvent('after the drop'));
    await settle();
    expect(frames).toContainEqual(channelEvent('after the drop'));

    server.streams[1].fail(new Error('socket hang up'));
    await settle();
    await upstream.endSession();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(server.streams).toHaveLength(2);
  });

  it('waits longer before each reopen of a stream that relays nothing', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    server.openStream = (stream) => {
      stream.end();
      return new Response(stream.body, { headers: { 'content-type': 'text/event-stream' } });
    };
    await upstream.send(initialize);
    await settle();

    await jest.advanceTimersByTimeAsync(FIRST_REOPEN_DELAY_MS);
    expect(server.streams).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(FIRST_REOPEN_DELAY_MS);
    expect(server.streams).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(FIRST_REOPEN_DELAY_MS);
    expect(server.streams).toHaveLength(3);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(server.streams.length).toBeLessThanOrEqual(20);
  });

  it.each([
    ['405', () => new Response(null, { status: 405 })],
    ['404', () => new Response(null, { status: 404 })],
    ['without a stream', () => new Response('{}', { headers: { 'content-type': 'application/json' } })],
  ])('does not ask again a server that answers %s, and says so once at debug level', async (_, answer) => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    server.openStream = answer;
    await upstream.send(initialize);
    await settle();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(server.sent('GET')).toHaveLength(1);
    expect(log.debug.mock.calls.map(([message]) => message)).toEqual(['notification-stream-unavailable']);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(onStreamLost).not.toHaveBeenCalled();
  });

  it.each([
    ['the server refuses it', () => new Response(null, { status: 503 }), { status: 503 } as Record<string, unknown>],
    [
      'the server is unreachable',
      () => Promise.reject(new Error('connect ECONNREFUSED')),
      { error: 'connect ECONNREFUSED' } as Record<string, unknown>,
    ],
  ])('gives the stream up once it could not be opened five times in a row: %s', async (_, answer, logged) => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    server.openStream = answer;
    await upstream.send(initialize);
    await settle();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(server.sent('GET')).toHaveLength(MAX_FAILED_OPENS);
    expect(log.debug).toHaveBeenCalledWith('notification-stream-failed', logged);
    expect(log.warn.mock.calls).toEqual([['notification-stream-lost', { attempts: MAX_FAILED_OPENS }]]);
    expect(onStreamLost).toHaveBeenCalledTimes(1);
  });

  it('reports a stream lost only once it gave it up, not at an open that failed before', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    server.openStream = () => new Response(null, { status: 503 });
    await upstream.send(initialize);
    await settle();

    await jest.advanceTimersByTimeAsync(GIVE_UP_AFTER_MS - 1);
    expect(server.sent('GET')).toHaveLength(MAX_FAILED_OPENS - 1);
    expect(onStreamLost).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(onStreamLost).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['close()', (client: HttpUpstreamClient) => client.close()],
    ['endSession()', (client: HttpUpstreamClient) => client.endSession()],
    ['leaveSession()', (client: HttpUpstreamClient) => client.leaveSession()],
  ])('reports no stream lost after %s ended the session during the open that would give it up', async (_, end) => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    server.openStream = (stream) => {
      if (server.streams.length < MAX_FAILED_OPENS) return new Response(null, { status: 503 });
      return new Promise<Response>((_resolve, reject) => {
        stream.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    await upstream.send(initialize);
    await settle();
    await jest.advanceTimersByTimeAsync(GIVE_UP_AFTER_MS);
    expect(server.sent('GET')).toHaveLength(MAX_FAILED_OPENS);

    await end(upstream);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(server.sent('GET')).toHaveLength(MAX_FAILED_OPENS);
    expect(onStreamLost).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalledWith('notification-stream-lost', expect.anything());
  });

  it('opens it again for the next session after it gave it up', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const holdOpen = server.openStream;
    server.openStream = () => new Response(null, { status: 503 });
    await upstream.send(initialize);
    await settle();
    await jest.advanceTimersByTimeAsync(60_000);

    server.openStream = holdOpen;
    await upstream.reinitialize(initialize, false);
    await settle();
    server.streams[server.streams.length - 1].send(channelEvent('the next session'));
    await settle();

    expect(frames).toContainEqual(channelEvent('the next session'));
  });

  it('never opens a stream for a session that close() ended while initialize was answered', async () => {
    const closing = createHttpUpstream({
      url: 'http://localhost/mcp',
      fetch: server.fetch,
      log,
      onFrame: () => closing.close(),
    });

    await closing.send(initialize);
    await settle();

    expect(server.sent('GET')).toEqual([]);
  });

  it('never logs the headers it sends', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    server.openStream = () => Promise.reject(new Error('connect ECONNREFUSED'));
    await upstream.send(initialize);
    await settle();
    await jest.advanceTimersByTimeAsync(60_000);

    const logged = JSON.stringify([log.debug, log.info, log.warn, log.error].map((level) => level.mock.calls));
    expect(logged).toContain('notification-stream-lost');
    expect(logged).not.toContain('shared-server-token');
  });
});
