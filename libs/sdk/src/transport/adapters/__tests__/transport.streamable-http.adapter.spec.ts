import 'reflect-metadata';

import { CallToolRequestSchema } from '@frontmcp/protocol';

import { createMcpServer } from '../../mcp-server.factory';
import {
  loadStreamableHttpTransport,
  resolveSessionIdGenerator,
  TransportStreamableHttpAdapter,
} from '../transport.streamable-http.adapter';

describe('resolveSessionIdGenerator', () => {
  it('returns a generator yielding __stateless__ for stateless transports', () => {
    const generator = resolveSessionIdGenerator('stateless-http', '__stateless__');
    expect(typeof generator).toBe('function');
    expect(generator?.()).toBe('__stateless__');
  });

  it('returns a stable generator for stateful transports', () => {
    const generator = resolveSessionIdGenerator('streamable-http', 'session-123');
    expect(typeof generator).toBe('function');
    expect(generator?.()).toBe('session-123');
  });
});

describe('TransportStreamableHttpAdapter.destroy', () => {
  beforeAll(() => loadStreamableHttpTransport());

  /** An adapter whose session has a tools/call in flight, with the signal that call's handler got. */
  async function adapterWithCallInFlight() {
    const adapter = Object.create(TransportStreamableHttpAdapter.prototype) as TransportStreamableHttpAdapter;
    Object.assign(adapter, {
      logger: { verbose: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      key: { type: 'streamable-http', sessionId: 'session-1' },
      scope: { eventStore: undefined, notifications: { unregisterServer: jest.fn() } },
      onDispose: jest.fn(),
    });
    const transport = adapter.createTransport('session-1', {} as never);
    Object.assign(adapter, { transport });
    const server = createMcpServer({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    const handlerSignal = new Promise<AbortSignal>((resolve) => {
      server.setRequestHandler(CallToolRequestSchema, (_request, extra) => {
        resolve(extra.signal);
        return new Promise((settle) => extra.signal.addEventListener('abort', () => settle({ content: [] })));
      });
    });
    await server.connect(transport);
    transport.onmessage?.({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wait', arguments: {} } });
    return { adapter, transport, signal: await handlerSignal };
  }

  it("aborts the session's in-flight calls before a DELETE's destroy resolves", async () => {
    const { adapter, signal } = await adapterWithCallInFlight();

    await adapter.destroy();

    expect(signal.aborted).toBe(true);
  });

  it('leaves the calls of a session dropped for a reason running', async () => {
    const { adapter, transport, signal } = await adapterWithCallInFlight();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await adapter.destroy('the session moved to another node');

    expect(signal.aborted).toBe(false);
    warn.mockRestore();
    await transport.close();
  });
});
