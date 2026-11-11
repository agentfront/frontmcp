/**
 * The HTTP upstream serves Claude Code channels when asked to. Claude Code probes a stdio server with
 * `server/discover` on MCP 2026-07-28, delivers channel events only to a session started with `initialize`, and
 * never declares `experimental['claude/channel']`.
 */
import type { JsonRpcFrame } from '../stdio-framer';
import { createHttpUpstream, type HttpUpstreamClient } from '../upstream-client';
import { CHANNEL_CAPABILITIES, FakeMcpServer, PLAIN_CAPABILITIES, recordingLog } from './helpers/fake-mcp-server';

const REVISION_META = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES = { roots: { listChanged: true }, elicitation: { form: {}, url: {} } };
const INITIALIZE_REVISIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const probe: JsonRpcFrame = {
  jsonrpc: '2.0',
  id: 'server-discover-probe-1',
  method: 'server/discover',
  params: {
    _meta: {
      [REVISION_META]: '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': CLIENT_CAPABILITIES,
    },
  },
};

const initialize: JsonRpcFrame = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: CLIENT_CAPABILITIES,
    clientInfo: { name: 'claude-code', version: '2.1.322' },
  },
};

/** A `tools/list` that names a revision in its `_meta`, as every 2026-07-28 request does. */
function modernToolsList(id: number, revision = '2026-07-28'): JsonRpcFrame {
  return { jsonrpc: '2.0', id, method: 'tools/list', params: { _meta: { [REVISION_META]: revision } } };
}

/** The `-32022` answer the bridge gives the request `id`. */
function declinedAnswer(id: string | number, requested = '2026-07-28'): JsonRpcFrame {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32022,
      message: `Unsupported protocol version: ${requested}`,
      data: { supported: INITIALIZE_REVISIONS, requested },
    },
  };
}

describe('the HTTP upstream serving Claude Code channels', () => {
  let server: FakeMcpServer;
  let frames: JsonRpcFrame[];
  let upstreams: HttpUpstreamClient[];

  beforeEach(() => {
    server = new FakeMcpServer();
    frames = [];
    upstreams = [];
  });

  afterEach(async () => {
    for (const upstream of upstreams) await upstream.close();
  });

  /** An upstream to the fake server, serving Claude Code channels unless `options` say otherwise. */
  function connect(options: { claudeCodeChannels?: boolean } = { claudeCodeChannels: true }): HttpUpstreamClient {
    const upstream = createHttpUpstream({
      url: 'http://localhost/mcp',
      fetch: server.fetch,
      log: recordingLog(),
      onFrame: (frame) => void frames.push(frame),
      ...options,
    });
    upstreams.push(upstream);
    return upstream;
  }

  describe('a server that advertises the channel capability', () => {
    beforeEach(() => {
      server.capabilities = CHANNEL_CAPABILITIES;
    });

    it('gets the 2026-07-28 probe declined with -32022 and its revisions before 2026-07-28', async () => {
      await connect().send(probe);

      expect(frames).toEqual([declinedAnswer('server-discover-probe-1')]);
    });

    it('is asked what it serves with a server/discover of the bridge, and never gets the probe of the client', async () => {
      await connect().send(probe);

      const [asked, ...others] = server.sent('POST');
      expect(others).toEqual([]);
      expect(asked.frame).toEqual({
        jsonrpc: '2.0',
        id: expect.stringMatching(/^frontmcp-dev-bridge:discover:/),
        method: 'server/discover',
        params: { _meta: { [REVISION_META]: '2026-07-28' } },
      });
      expect(asked.headers).toMatchObject({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' });
    });

    it('gets its later 2026-07-28 requests declined without being asked again, each naming the revision it asked for', async () => {
      const upstream = connect();
      await upstream.send(probe);
      await upstream.send(modernToolsList(7));
      await upstream.send(modernToolsList(8, '2099-01-01'));
      await upstream.send({ jsonrpc: '2.0', id: 9, method: 'subscriptions/listen' });

      expect(frames).toEqual([
        declinedAnswer('server-discover-probe-1'),
        declinedAnswer(7),
        declinedAnswer(8, '2099-01-01'),
        declinedAnswer(9),
      ]);
      expect(server.sent('POST')).toHaveLength(1);
    });

    it('gets no 2026-07-28 notification, and the client no answer to it', async () => {
      const upstream = connect();
      await upstream.send(probe);
      await upstream.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 7, _meta: { [REVISION_META]: '2026-07-28' } },
      });

      expect(frames).toEqual([declinedAnswer('server-discover-probe-1')]);
      expect(server.sent('POST')).toHaveLength(1);
    });

    it('still gets the requests of the session initialize starts', async () => {
      const upstream = connect();
      await upstream.send(probe);
      await upstream.send(initialize);
      await upstream.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

      expect(frames[2]).toEqual({ jsonrpc: '2.0', id: 2, result: { answered: 'tools/list' } });
      expect(server.sent('POST')[2].headers['mcp-session-id']).toBe('session-1');
    });

    it('sends the session id with no request of 2026-07-28, which has no session', async () => {
      const upstream = connect();
      await upstream.send(initialize);
      await upstream.send(modernToolsList(7));

      const [, asked] = server.sent('POST');
      expect(asked.frame?.method).toBe('server/discover');
      expect(asked.headers).not.toHaveProperty('mcp-session-id');
      expect(frames[1]).toEqual(declinedAnswer(7));
    });

    it('is asked again once an initialize result says it no longer pushes channels', async () => {
      const upstream = connect();
      await upstream.send(probe);
      server.capabilities = PLAIN_CAPABILITIES;
      await upstream.send(initialize);
      await upstream.send(modernToolsList(7));

      expect(server.postedFrames().map((frame) => frame.method)).toEqual([
        'server/discover',
        'initialize',
        'server/discover',
        'tools/list',
      ]);
      expect(frames[2]).toEqual({ jsonrpc: '2.0', id: 7, result: { answered: 'tools/list' } });
    });

    it('is asked again once a replayed initialize says it no longer pushes channels', async () => {
      const upstream = connect();
      await upstream.send(probe);
      server.capabilities = PLAIN_CAPABILITIES;
      await upstream.reinitialize(initialize, false);
      await upstream.send(modernToolsList(7));

      expect(frames[1]).toEqual({ jsonrpc: '2.0', id: 7, result: { answered: 'tools/list' } });
    });
  });

  describe('a server that advertises no channel capability', () => {
    it('gets the 2026-07-28 probe of the client as it is, and refuses it as before', async () => {
      await expect(connect().send(probe)).rejects.toThrow('upstream returned 400 for server/discover');

      const [, forwarded] = server.sent('POST');
      expect(forwarded.frame).toEqual(probe);
      expect(forwarded.headers).not.toHaveProperty('mcp-protocol-version');
      expect(frames).toEqual([]);
    });

    it('gets the later 2026-07-28 requests too, without being asked again, and its answers are relayed', async () => {
      const upstream = connect();
      await upstream.send(modernToolsList(7));
      await upstream.send(modernToolsList(8));

      expect(server.postedFrames()).toEqual([expect.anything(), modernToolsList(7), modernToolsList(8)]);
      expect(frames).toEqual([
        { jsonrpc: '2.0', id: 7, result: { answered: 'tools/list' } },
        { jsonrpc: '2.0', id: 8, result: { answered: 'tools/list' } },
      ]);
    });

    it('gets the 2026-07-28 requests when it does not answer the server/discover of the bridge', async () => {
      server.speaks20260728 = false;
      const upstream = connect();
      await upstream.send(modernToolsList(7));
      await upstream.send(modernToolsList(8));

      expect(server.postedFrames().map((frame) => frame.method)).toEqual([
        'server/discover',
        'tools/list',
        'server/discover',
        'tools/list',
      ]);
      expect(frames.map((frame) => frame.id)).toEqual([7, 8]);
    });

    it('is declined once an initialize result says it pushes channels now', async () => {
      const upstream = connect();
      await upstream.send(modernToolsList(7));
      server.capabilities = CHANNEL_CAPABILITIES;
      await upstream.send(initialize);
      await upstream.send(modernToolsList(8));

      expect(frames[2]).toEqual(declinedAnswer(8));
    });
  });

  describe('the initialize it forwards', () => {
    it('declares the channel capability for the client, and keeps the capabilities the client declared', async () => {
      await connect().send(initialize);

      expect(server.postedFrames()).toEqual([
        {
          ...initialize,
          params: {
            ...(initialize.params as object),
            capabilities: { ...CLIENT_CAPABILITIES, experimental: { 'claude/channel': {} } },
          },
        },
      ]);
      expect(initialize.params).toEqual({
        protocolVersion: '2025-11-25',
        capabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: 'claude-code', version: '2.1.322' },
      });
    });

    it('keeps the experimental capabilities of the client, and the channel capability it declared itself', async () => {
      const declared = { experimental: { 'claude/channel': { permission: true }, 'acme/other': {} } };
      const declaring = { ...initialize, params: { ...(initialize.params as object), capabilities: declared } };
      const others = { experimental: { 'acme/other': {} } };
      const withOthers = { ...initialize, params: { ...(initialize.params as object), capabilities: others } };

      await connect().send(declaring);
      await connect().send(withOthers);

      const [first, second] = server.postedFrames();
      expect(first).toEqual(declaring);
      expect((second.params as { capabilities: unknown }).capabilities).toEqual({
        experimental: { 'acme/other': {}, 'claude/channel': {} },
      });
    });

    it('declares it on the replayed initialize too', async () => {
      await connect().reinitialize(initialize, true);

      const [replayed] = server.postedFrames();
      expect((replayed.params as { capabilities: unknown }).capabilities).toEqual({
        ...CLIENT_CAPABILITIES,
        experimental: { 'claude/channel': {} },
      });
    });

    it('relays the result of the server unchanged', async () => {
      server.capabilities = CHANNEL_CAPABILITIES;
      await connect().send(initialize);

      expect(frames).toEqual([
        { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: CHANNEL_CAPABILITIES } },
      ]);
    });
  });

  describe.each([
    ['without the option', {}],
    ['with the option off', { claudeCodeChannels: false }],
  ])('%s, as a plain relay', (_, plainRelay) => {
    beforeEach(() => {
      server.capabilities = CHANNEL_CAPABILITIES;
    });

    it('forwards a 2026-07-28 request as it is, and asks the server nothing itself', async () => {
      await connect(plainRelay).send(modernToolsList(7));

      expect(server.postedFrames()).toEqual([modernToolsList(7)]);
      expect(frames).toEqual([{ jsonrpc: '2.0', id: 7, result: { answered: 'tools/list' } }]);
    });

    it('forwards initialize as the client sent it', async () => {
      await connect(plainRelay).send(initialize);
      await connect(plainRelay).reinitialize(initialize, false);

      const [sent, replayed] = server.postedFrames();
      expect(sent).toEqual(initialize);
      expect(replayed.params).toEqual(initialize.params);
    });
  });
});
