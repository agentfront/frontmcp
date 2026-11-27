/**
 * A tool call that stays quiet keeps its response stream alive with keep-alive comments at `transport.sse.heartbeatMs`,
 * so a proxy's idle timeout does not cut it (#1479): the 2026-07-28 request stream and the Streamable HTTP one.
 */
import 'reflect-metadata';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../common';

let release: () => void = () => undefined;

@Tool({ name: 'held', description: 'Answers once the test releases it', inputSchema: {} })
class HeldTool extends ToolContext {
  async execute() {
    await new Promise<void>((resolve) => (release = resolve));
    return 'released';
  }
}

@App({ id: 'keep-alive', name: 'keep-alive', tools: [HeldTool] })
class KeepAliveApp {}

const decoder = new TextDecoder();

/** Reads the stream until `done` holds for what came so far, failing after two seconds. */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, done: (text: string) => boolean) {
  let text = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => (timer = setTimeout(resolve, 2_000, 'timeout')));
  try {
    while (!done(text)) {
      const step = await Promise.race([reader.read(), timedOut]);
      if (step === 'timeout') throw new Error(`the stream sent only: ${JSON.stringify(text)}`);
      if (step.done) throw new Error(`the stream ended after: ${JSON.stringify(text)}`);
      text += decoder.decode(step.value, { stream: true });
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function heldCall(headers: Record<string, string>, meta?: Record<string, unknown>): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'held', arguments: {}, ...(meta ? { _meta: meta } : {}) },
    }),
  });
}

describe('MCP response stream keep-alive', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'keep-alive', version: '1.0.0' },
      apps: [KeepAliveApp],
      transport: { sse: { heartbeatMs: 50 } },
    });
  });

  afterAll(async () => {
    release();
    await server.instance.shutdown();
  });

  it('sends keep-alive comments on a 2026-07-28 request stream while the tool runs, then its result', async () => {
    const response = await server.handler(
      heldCall(
        { 'mcp-protocol-version': PROTOCOL_2026_07_28, 'mcp-method': 'tools/call', 'mcp-name': 'held' },
        {
          [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
          [MCP_20260728_META.clientInfo]: { name: 'spec-client', version: '1.0.0' },
          [MCP_20260728_META.clientCapabilities]: {},
          progressToken: 'held-1',
        },
      ),
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    const quiet = await readUntil(reader, (text) => text.split(': keep-alive\n\n').length > 2);
    expect(quiet).toBe(': keep-alive\n\n'.repeat(quiet.split(': keep-alive\n\n').length - 1));

    release();
    const answer = await readUntil(reader, (text) => text.includes('"id":1'));
    const event = answer.split('\n\n').find((frame) => frame.startsWith('event: message'));
    expect(JSON.parse((event as string).replace('event: message\ndata: ', ''))).toMatchObject({
      id: 1,
      result: { content: [{ type: 'text', text: expect.stringContaining('released') }] },
    });
  });

  it('sends keep-alive comments at transport.sse.heartbeatMs on a Streamable HTTP response stream', async () => {
    const response = await server.handler(heldCall({ 'mcp-protocol-version': '2025-06-18' }));
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    expect(await readUntil(reader, (text) => text.includes(': keepalive\n\n'))).toMatch(/^: keepalive\n\n/);

    release();
    await readUntil(reader, (text) => text.includes('"released'));
    await reader.cancel();
  });
});
