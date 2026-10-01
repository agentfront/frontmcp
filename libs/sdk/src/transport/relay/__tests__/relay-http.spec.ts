import { ListToolsRequestSchema, McpServer, StreamableHTTPServerTransport } from '@frontmcp/protocol';

import type { ServerRequest } from '../../../common';
import { ServerRequestTokens } from '../../../common/tokens/server.tokens';
import type { RelayedHttpRequest } from '../../../ha/relay-messages';
import {
  createRelayedServerRequest,
  decodeRelayChunk,
  encodeRelayChunk,
  isRelayedRequest,
  relayedFrom,
  RelayServerResponse,
  serializeRelayRequest,
  type RelayChunk,
} from '../relay-http';

/** Collects what a relayed response writes, decoded to text. */
function createSink() {
  const events: Array<
    | { type: 'head'; status: number; headers: Record<string, string | string[]> }
    | { type: 'data'; text: string }
    | {
        type: 'end';
      }
  > = [];
  const sink = {
    head: jest.fn((status: number, headers: Record<string, string | string[]>) =>
      events.push({ type: 'head', status, headers }),
    ),
    data: jest.fn((chunk: RelayChunk) => {
      const decoded = decodeRelayChunk(chunk);
      events.push({ type: 'data', text: typeof decoded === 'string' ? decoded : new TextDecoder().decode(decoded) });
    }),
    end: jest.fn(() => events.push({ type: 'end' })),
  };
  const body = () =>
    events
      .filter((e): e is { type: 'data'; text: string } => e.type === 'data')
      .map((e) => e.text)
      .join('');
  return { sink, events, body };
}

function relayed(overrides: Partial<RelayedHttpRequest> = {}): RelayedHttpRequest {
  return {
    method: 'POST',
    url: '/mcp?x=1',
    path: '/mcp',
    headers: { host: 'mcp.example.com', 'content-type': 'application/json' },
    query: { x: '1' },
    body: { jsonrpc: '2.0', id: 1, method: 'ping' },
    ...overrides,
  };
}

describe('relay-http', () => {
  describe('serializeRelayRequest', () => {
    it('keeps what the owner needs to serve the request', () => {
      const request = {
        method: 'post',
        url: '/inner',
        originalUrl: '/mcp?x=1',
        path: '/mcp',
        headers: { Host: 'mcp.example.com', 'X-Multi': ['a', 'b'], 'X-Num': 3, 'X-Undef': undefined },
        query: { x: '1' },
        body: { jsonrpc: '2.0', id: 7, method: 'tools/list' },
        protocol: 'https',
        socket: { remoteAddress: '203.0.113.9', encrypted: true },
      } as unknown as ServerRequest;

      expect(serializeRelayRequest(request)).toEqual({
        method: 'POST',
        url: '/mcp?x=1',
        path: '/mcp',
        headers: { host: 'mcp.example.com', 'x-multi': ['a', 'b'], 'x-num': '3' },
        query: { x: '1' },
        body: { jsonrpc: '2.0', id: 7, method: 'tools/list' },
        protocol: 'https',
        encrypted: true,
        peerAddress: '203.0.113.9',
      });
    });

    it('falls back to url, derives the path, and leaves out what is missing', () => {
      const request = { url: '/sse?sessionId=abc' } as unknown as ServerRequest;
      expect(serializeRelayRequest(request)).toEqual({
        method: 'GET',
        url: '/sse?sessionId=abc',
        path: '/sse',
        headers: {},
        query: {},
      });
      expect(serializeRelayRequest({ url: '/plain' } as unknown as ServerRequest).path).toBe('/plain');
      expect(serializeRelayRequest({} as unknown as ServerRequest).url).toBe('/');
    });
  });

  describe('createRelayedServerRequest', () => {
    it('rebuilds a request the flows and the MCP transports can read', () => {
      const request = createRelayedServerRequest(
        relayed({
          headers: { Host: 'mcp.example.com', 'X-Multi': ['a', 'b'] },
          peerAddress: '198.51.100.4',
          encrypted: true,
        }),
        'node-a',
      ) as unknown as Record<string, unknown> & ServerRequest;

      expect(request.method).toBe('POST');
      expect(request.url).toBe('/mcp?x=1');
      expect(request['originalUrl']).toBe('/mcp?x=1');
      expect(request.path).toBe('/mcp');
      expect(request.headers).toEqual({ host: 'mcp.example.com', 'x-multi': ['a', 'b'] });
      expect(request['rawHeaders']).toEqual(['host', 'mcp.example.com', 'x-multi', 'a', 'x-multi', 'b']);
      expect(request.query).toEqual({ x: '1' });
      expect(request.body).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(request['protocol']).toBe('https');
      expect(request['secure']).toBe(true);
      expect(request.socket).toEqual({ remoteAddress: '198.51.100.4', encrypted: true });
      expect(Buffer.isBuffer(request['rawBody'])).toBe(true);
      expect(String(request['rawBody'])).toBe('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      expect(() => (request as unknown as { destroy(): void }).destroy()).not.toThrow();
      expect(relayedFrom(request)).toBe('node-a');
      expect(isRelayedRequest(request)).toBe(true);
    });

    it('keeps a text body as-is and adds no raw body without one', () => {
      const text = createRelayedServerRequest(relayed({ body: 'plain text' }), 'node-a') as unknown as Record<
        string,
        unknown
      >;
      expect(String(text['rawBody'])).toBe('plain text');

      const noBody = createRelayedServerRequest(relayed({ body: undefined, protocol: undefined }), 'node-a');
      expect((noBody as unknown as Record<string, unknown>)['rawBody']).toBeUndefined();
      expect((noBody as unknown as Record<string, unknown>)['protocol']).toBe('http');
      expect((noBody as unknown as Record<string, unknown>)['secure']).toBe(false);
      expect(
        (createRelayedServerRequest(relayed({ query: undefined as never }), 'n') as unknown as ServerRequest).query,
      ).toEqual({});
    });

    it('is an event emitter', () => {
      const request = createRelayedServerRequest(relayed(), 'node-a') as unknown as {
        on(event: string, listener: () => void): unknown;
        emit(event: string): boolean;
      };
      const listener = jest.fn();
      request.on('end', listener);
      expect(request.emit('end')).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('a request received directly is not relayed', () => {
      const request = { headers: {} } as unknown as ServerRequest;
      expect(isRelayedRequest(request)).toBe(false);
      expect(relayedFrom(request)).toBeUndefined();
      (request as unknown as Record<PropertyKey, unknown>)[ServerRequestTokens.relayedFrom] = 42;
      expect(relayedFrom(request)).toBeUndefined();
    });
  });

  describe('relay chunks', () => {
    it('carries text and UTF-8 bytes as utf8, other bytes as base64', () => {
      expect(encodeRelayChunk('hello')).toEqual({ data: 'hello', encoding: 'utf8' });
      expect(encodeRelayChunk('aGk=', 'base64')).toEqual({ data: 'aGk=', encoding: 'base64' });
      expect(encodeRelayChunk(new Uint8Array([104, 105]))).toEqual({ data: 'hi', encoding: 'utf8' });
      expect(encodeRelayChunk(new Uint8Array([104, 105]).buffer)).toEqual({ data: 'hi', encoding: 'utf8' });
      expect(encodeRelayChunk(42)).toEqual({ data: '42', encoding: 'utf8' });
      // Invalid UTF-8 (binary, or a character split across chunks) is sent as base64, byte for byte.
      const binary = new Uint8Array([0xff, 0x00, 0xc3]);
      const encoded = encodeRelayChunk(binary);
      expect(encoded?.encoding).toBe('base64');
      expect(Array.from(decodeRelayChunk(encoded as RelayChunk) as Uint8Array)).toEqual([0xff, 0x00, 0xc3]);
      // A byte-order mark is kept.
      expect(encodeRelayChunk(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ data: '\ufeffa', encoding: 'utf8' });
    });

    it('drops empty chunks', () => {
      expect(encodeRelayChunk(undefined)).toBeUndefined();
      expect(encodeRelayChunk(null)).toBeUndefined();
      expect(encodeRelayChunk('')).toBeUndefined();
      expect(encodeRelayChunk(new Uint8Array(0))).toBeUndefined();
      expect(encodeRelayChunk(new ArrayBuffer(0))).toBeUndefined();
      expect(encodeRelayChunk({ toString: () => '' })).toBeUndefined();
    });

    it('decodes what it encodes', () => {
      expect(decodeRelayChunk({ data: 'hi', encoding: 'utf8' })).toBe('hi');
      expect(Array.from(decodeRelayChunk({ data: 'aGk=', encoding: 'base64' }) as Uint8Array)).toEqual([104, 105]);
    });
  });

  describe('RelayServerResponse', () => {
    it('sends the head once, before the first body chunk, without hop-by-hop headers', () => {
      const { sink, events } = createSink();
      const response = new RelayServerResponse(sink);
      response.setHeader('Content-Type', 'text/plain');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('Transfer-Encoding', 'chunked');
      response.setHeader('X-Count', 3);
      response.setHeader('Set-Cookie', ['a=1', 'b=2']);

      expect(response.write('one')).toBe(true);
      response.write(new Uint8Array([116, 119, 111]), () => undefined);
      response.end('three');

      expect(events).toEqual([
        {
          type: 'head',
          status: 200,
          headers: { 'content-type': 'text/plain', 'x-count': '3', 'set-cookie': ['a=1', 'b=2'] },
        },
        { type: 'data', text: 'one' },
        { type: 'data', text: 'two' },
        { type: 'data', text: 'three' },
        { type: 'end' },
      ]);
      expect(response.headersSent).toBe(true);
      expect(response.writableEnded).toBe(true);
      expect(response.writableFinished).toBe(true);
      expect(response.finished).toBe(true);
      expect(response.writable).toBe(false);
    });

    it('manages headers like a Node response', () => {
      const { sink } = createSink();
      const response = new RelayServerResponse(sink);
      response.setHeader('X-A', '1');
      response.setHeader('X-B', '2');
      expect(response.getHeader('x-a')).toBe('1');
      expect(response.hasHeader('X-B')).toBe(true);
      expect(response.getHeaderNames()).toEqual(['x-a', 'x-b']);
      response.removeHeader('X-B');
      expect(response.getHeaders()).toEqual({ 'x-a': '1' });

      response.flushHeaders();
      response.setHeader('X-Late', 'ignored');
      response.removeHeader('X-A');
      expect(response.getHeader('x-late')).toBeUndefined();
      expect(response.getHeader('x-a')).toBe('1');
      expect(sink.head).toHaveBeenCalledTimes(1);
    });

    it('writeHead takes a header object, a reason phrase, or a flat header list', () => {
      const first = createSink();
      new RelayServerResponse(first.sink).writeHead(201, { 'X-One': '1', 'X-Skip': undefined }).end();
      expect(first.events[0]).toEqual({ type: 'head', status: 201, headers: { 'x-one': '1' } });

      const second = createSink();
      const withReason = new RelayServerResponse(second.sink);
      withReason.writeHead(202, 'Accepted', { 'X-Two': '2' });
      withReason.writeHead(500, { 'X-Ignored': 'yes' });
      expect(withReason.statusMessage).toBe('Accepted');
      expect(second.events).toEqual([{ type: 'head', status: 202, headers: { 'x-two': '2' } }]);

      const third = createSink();
      new RelayServerResponse(third.sink).writeHead(204, ['X-Three', '3', 'X-Four', '4']).end();
      expect(third.events[0]).toEqual({ type: 'head', status: 204, headers: { 'x-three': '3', 'x-four': '4' } });

      const fourth = createSink();
      new RelayServerResponse(fourth.sink).writeHead(200).end();
      expect(fourth.events[0]).toEqual({ type: 'head', status: 200, headers: {} });
    });

    it('supports the Express helpers the flows use', () => {
      const json = createSink();
      new RelayServerResponse(json.sink).status(202).json({ ok: true });
      expect(json.events[0]).toEqual({
        type: 'head',
        status: 202,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
      expect(json.body()).toBe('{"ok":true}');

      const html = createSink();
      new RelayServerResponse(html.sink).send('<p>hi</p>');
      expect(html.events[0]).toEqual(
        expect.objectContaining({ headers: { 'content-type': 'text/html; charset=utf-8' } }),
      );

      const bytes = createSink();
      new RelayServerResponse(bytes.sink).send(new Uint8Array([1]));
      expect(bytes.events[0]).toEqual(
        expect.objectContaining({ headers: { 'content-type': 'application/octet-stream' } }),
      );

      const object = createSink();
      new RelayServerResponse(object.sink).send({ a: 1 });
      expect(object.body()).toBe('{"a":1}');

      const typed = createSink();
      const typedResponse = new RelayServerResponse(typed.sink);
      typedResponse.setHeader('Content-Type', 'text/plain');
      typedResponse.send('kept');
      typedResponse.json({ late: true });
      expect(typed.events[0]).toEqual(expect.objectContaining({ headers: { 'content-type': 'text/plain' } }));

      const empty = createSink();
      new RelayServerResponse(empty.sink).send();
      expect(empty.events).toEqual([{ type: 'head', status: 200, headers: {} }, { type: 'end' }]);
    });

    it('redirects with a default or an explicit status', () => {
      const temporary = createSink();
      new RelayServerResponse(temporary.sink).redirect('/login');
      expect(temporary.events[0]).toEqual({ type: 'head', status: 302, headers: { location: '/login' } });

      const permanent = createSink();
      new RelayServerResponse(permanent.sink).redirect(301, '/new');
      expect(permanent.events[0]).toEqual({ type: 'head', status: 301, headers: { location: '/new' } });

      const fallback = createSink();
      new RelayServerResponse(fallback.sink).redirect(307);
      expect(fallback.events[0]).toEqual({ type: 'head', status: 307, headers: { location: '/' } });
    });

    it('end() accepts the Node argument forms and runs only once', () => {
      const { sink, events } = createSink();
      const response = new RelayServerResponse(sink);
      const finish = jest.fn();
      const close = jest.fn();
      response.on('finish', finish);
      response.once('close', close);

      const first = jest.fn();
      response.end(first);
      expect(first).toHaveBeenCalledTimes(1);

      const again = jest.fn();
      response.end('ignored', again);
      response.end('ignored', 'utf8', again);
      expect(again).toHaveBeenCalledTimes(2);
      expect(response.write('late')).toBe(false);

      expect(events).toEqual([{ type: 'head', status: 200, headers: {} }, { type: 'end' }]);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      const withEncoding = createSink();
      const encodedEnd = jest.fn();
      new RelayServerResponse(withEncoding.sink).end('aGk=', 'base64', encodedEnd);
      expect(withEncoding.body()).toBe('hi');
      expect(encodedEnd).toHaveBeenCalled();

      const writeWithEncoding = createSink();
      const writer = new RelayServerResponse(writeWithEncoding.sink);
      const written = jest.fn();
      writer.write('aGk=', 'base64', written);
      expect(writeWithEncoding.body()).toBe('hi');
      expect(written).toHaveBeenCalled();
    });

    it('destroy() closes without finishing and silences the sink', () => {
      const { sink, events } = createSink();
      const response = new RelayServerResponse(sink);
      const finish = jest.fn();
      const close = jest.fn();
      const error = jest.fn();
      response.on('finish', finish);
      response.on('close', close);
      response.addListener('error', error);
      response.write('partial');

      response.destroy(new Error('client gone'));
      response.destroy();

      expect(response.destroyed).toBe(true);
      expect(response.writable).toBe(false);
      expect(close).toHaveBeenCalledTimes(1);
      expect(finish).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'client gone' }));
      expect(response.write('more')).toBe(false);
      response.end('ignored');
      expect(events.map((e) => e.type)).toEqual(['head', 'data']);
    });

    it('destroy() without an error listener or after finishing emits nothing extra', () => {
      const { sink } = createSink();
      const response = new RelayServerResponse(sink);
      response.end();
      const close = jest.fn();
      response.on('close', close);
      response.destroy(new Error('late'));
      expect(close).not.toHaveBeenCalled();

      const unstarted = new RelayServerResponse(createSink().sink);
      unstarted.destroy();
      unstarted.flushHeaders();
      expect(unstarted.headersSent).toBe(false);
    });

    it('event listeners can be removed', () => {
      const response = new RelayServerResponse(createSink().sink);
      const listener = jest.fn();
      response.on('close', listener);
      response.removeListener('close', listener);
      response.off('close', jest.fn());
      response.off('missing', listener);
      expect(response.listenerCount('close')).toBe(0);

      const onceListener = jest.fn();
      response.once('finish', onceListener);
      response.off('finish', onceListener);
      expect(response.listenerCount('finish')).toBe(0);

      response.on('a', listener).on('b', listener);
      response.removeAllListeners('a');
      expect(response.listenerCount('a')).toBe(0);
      expect(response.listenerCount('b')).toBe(1);
      response.removeAllListeners();
      expect(response.listenerCount('b')).toBe(0);
      expect(response.emit('nothing')).toBe(false);
    });

    it('has the Node no-ops and exposes itself as a ServerResponse', () => {
      const response = new RelayServerResponse(createSink().sink);
      expect(() => {
        response.cork();
        response.uncork();
      }).not.toThrow();
      expect(response.setTimeout()).toBe(response);
      expect(response.asServerResponse()).toBe(response);
    });
  });

  describe('with the MCP SDK Streamable HTTP transport', () => {
    async function connect() {
      const server = new McpServer({ name: 'relay-test', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: 'echo', inputSchema: { type: 'object' as const } }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => 'relay-session' });
      await server.connect(transport);
      return { server, transport };
    }

    function request(body: unknown, headers: Record<string, string> = {}, method = 'POST') {
      return createRelayedServerRequest(
        {
          method,
          url: '/mcp',
          path: '/mcp',
          headers: {
            host: 'localhost:3000',
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...headers,
          },
          query: {},
          body,
        },
        'node-b',
      );
    }

    it('serves a relayed initialize and a relayed request through the transport', async () => {
      const { server, transport } = await connect();

      const init = createSink();
      const initBody = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      };
      await transport.handleRequest(
        request(initBody) as never,
        new RelayServerResponse(init.sink).asServerResponse() as never,
        initBody,
      );
      const initHead = init.events[0] as { type: 'head'; status: number; headers: Record<string, string> };
      expect(initHead.status).toBe(200);
      expect(initHead.headers['mcp-session-id']).toBe('relay-session');
      expect(init.body()).toContain('"serverInfo"');
      expect(init.events.at(-1)).toEqual({ type: 'end' });

      const list = createSink();
      const listBody = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
      await transport.handleRequest(
        request(listBody, { 'mcp-session-id': 'relay-session', 'mcp-protocol-version': '2025-06-18' }) as never,
        new RelayServerResponse(list.sink).asServerResponse() as never,
        listBody,
      );
      expect(list.body()).toContain('"name":"echo"');
      expect(list.events.at(-1)).toEqual({ type: 'end' });

      await server.close();
    });

    it('closes a relayed notification stream when the relaying client goes away', async () => {
      const { server, transport } = await connect();
      const initBody = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      };
      await transport.handleRequest(
        request(initBody) as never,
        new RelayServerResponse(createSink().sink).asServerResponse() as never,
        initBody,
      );

      const stream = createSink();
      const response = new RelayServerResponse(stream.sink);
      const serving = transport.handleRequest(
        request(
          undefined,
          { 'mcp-session-id': 'relay-session', accept: 'text/event-stream', 'mcp-protocol-version': '2025-06-18' },
          'GET',
        ) as never,
        response.asServerResponse() as never,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      const head = stream.events[0] as { type: 'head'; status: number; headers: Record<string, string> };
      expect(head.status).toBe(200);
      expect(head.headers['content-type']).toBe('text/event-stream');

      response.destroy();
      await serving;
      expect(stream.events.some((e) => e.type === 'end')).toBe(false);

      await server.close();
    });
  });
});
