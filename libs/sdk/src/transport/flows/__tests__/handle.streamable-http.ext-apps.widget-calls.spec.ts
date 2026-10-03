/**
 * Widget calls back to the server over a session (#681):
 *  - `ui/callServerTool` is the widget asking for data. The widget is already on screen, so the
 *    result carries the tool's data but not its rendered page (`_meta['ui/html']`), which a
 *    regular `tools/call` of the same tool still gets.
 *  - A `ui/*` method that returns nothing (`ui/log`) answers with `result: {}`: a JSON-RPC success
 *    response without `result` is not a valid response.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

@Tool({
  name: 'weather',
  inputSchema: { city: z.string() },
  ui: { template: (ctx: { output: unknown }) => `<p>${JSON.stringify(ctx.output)}</p>` },
})
class WeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city, temperature: 21 };
  }
}

@App({ id: 'forecast', name: 'Forecast', tools: [WeatherTool] })
class ForecastApp {}

type JsonRpcAnswer = { jsonrpc: string; id: unknown; result?: Record<string, unknown>; error?: unknown };

describe('widget calls over a session', () => {
  let node: http.Server;
  let base: string;
  let sessionId: string;

  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${base}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, ...body }),
    });

  /** The JSON-RPC message of a response, whether it came as JSON or as one SSE event. */
  async function answerOf(response: Response): Promise<JsonRpcAnswer> {
    const text = await response.text();
    const data = text.trimStart().startsWith('{')
      ? text
      : text
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('');
    return JSON.parse(data) as JsonRpcAnswer;
  }

  beforeAll(async () => {
    const app = (await FrontMcpInstance.createHandler({
      info: { name: 'widget-calls', version: '1.0.0' },
      logging: { level: LogLevel.Off },
      apps: [ForecastApp],
    })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;

    const initialized = await post({
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'host', version: '1.0.0' } },
    });
    sessionId = initialized.headers.get('mcp-session-id') ?? '';
    await initialized.text();
    expect(sessionId).not.toBe('');
    await (await post({ method: 'notifications/initialized', id: undefined }, { 'mcp-session-id': sessionId })).text();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => node.close(() => resolve()));
  });

  it('a regular tools/call carries the rendered page', async () => {
    const answer = await answerOf(
      await post(
        { method: 'tools/call', params: { name: 'weather', arguments: { city: 'Oslo' } } },
        { 'mcp-session-id': sessionId },
      ),
    );

    const meta = answer.result?.['_meta'] as Record<string, unknown> | undefined;
    expect(typeof meta?.['ui/html']).toBe('string');
  });

  it('ui/callServerTool returns the data without the page', async () => {
    const answer = await answerOf(
      await post(
        { method: 'ui/callServerTool', params: { name: 'weather', arguments: { city: 'Oslo' } } },
        { 'mcp-session-id': sessionId },
      ),
    );

    expect(answer.error).toBeUndefined();
    const result = answer.result ?? {};
    expect(JSON.stringify(result)).toContain('"temperature":21');
    expect((result['_meta'] as Record<string, unknown> | undefined)?.['ui/html']).toBeUndefined();
  });

  it('ui/log answers with an empty result', async () => {
    const answer = await answerOf(
      await post(
        { method: 'ui/log', params: { level: 'info', message: 'widget says hi' } },
        { 'mcp-session-id': sessionId },
      ),
    );

    expect(answer).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });
});
