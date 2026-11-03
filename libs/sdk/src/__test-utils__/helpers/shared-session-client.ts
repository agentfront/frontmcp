import * as http from 'node:http';
import type { PassThrough } from 'node:stream';

import type { SharedServerRecord } from '../../shared/shared-files';

export interface Frame {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

/** Speak newline-delimited JSON-RPC to a session through its stdio streams. */
export function clientOf(input: PassThrough, output: PassThrough) {
  const received: Frame[] = [];
  let pending = '';
  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) if (line) received.push(JSON.parse(line) as Frame);
  });
  async function waitFor(match: (frame: Frame) => boolean, what: string, timeoutMs = 15_000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = received.find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no ${what}: ${JSON.stringify(received)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  return {
    received,
    waitFor,
    send: (frame: Frame) => input.write(`${JSON.stringify(frame)}\n`),
    request(frame: Frame, timeoutMs?: number): Promise<Frame> {
      input.write(`${JSON.stringify(frame)}\n`);
      return waitFor(
        ({ id, method }) => id === frame.id && method === undefined,
        `answer to ${frame.method}`,
        timeoutMs,
      );
    },
  };
}

export const initialize: Frame = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'shared-spec', version: '1.0.0' } },
};

export function callTool(id: number, name: string): Frame {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } };
}

/** The structured result of a tool call, or its text parsed as JSON. */
export function structuredOf(answer: Frame): Record<string, unknown> {
  const result = answer.result as { structuredContent?: Record<string, unknown>; content?: Array<{ text: string }> };
  return result.structuredContent ?? (JSON.parse(result.content?.[0]?.text ?? '{}') as Record<string, unknown>);
}

export function pidOf(answer: Frame): unknown {
  return structuredOf(answer)['pid'];
}

/** POST `body` to a shared server on loopback HTTP, as JSON. */
export function post(
  record: SharedServerRecord,
  urlPath: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: record.port,
        path: urlPath,
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk: Buffer) => (text += chunk.toString()));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }));
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}
