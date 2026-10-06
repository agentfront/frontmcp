/**
 * `requestLogs.onRequestComplete` sees the status of the response the HTTP flow actually sent (#766):
 * a 401 from authentication or a 429 from the throttle is logged as an error with its status code,
 * and a slow callback never holds the response.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '@frontmcp/sdk';

import ObservabilityPlugin from '../plugin/observability.plugin';
import type { RequestLog } from '../request-log/request-log.types';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

function listToolsRequest(): Request {
  return new Request('https://desk.example.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
}

function serverLogging(
  onRequestComplete: (log: RequestLog) => void | Promise<void>,
  config: Partial<FrontMcpConfigInput>,
) {
  return FrontMcpInstance.createFetchHandler({
    info: { name: 'desk', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    plugins: [ObservabilityPlugin.init({ tracing: false, requestLogs: { onRequestComplete } })],
    ...config,
  } as FrontMcpConfigInput);
}

describe('request logs of real HTTP responses', () => {
  it('logs a 401 from authentication as an error with its status code', async () => {
    const logs: RequestLog[] = [];
    const handler = await serverLogging((log) => void logs.push(log), {
      auth: { mode: 'static', tokens: ['secret'] },
    });

    const response = await handler(listToolsRequest());

    expect(response.status).toBe(401);
    expect(logs).toEqual([expect.objectContaining({ status: 'error', status_code: 401 })]);
  });

  it('logs a 429 from the throttle as an error with its status code', async () => {
    const logs: RequestLog[] = [];
    const handler = await serverLogging((log) => void logs.push(log), {
      throttle: { enabled: true, global: { maxRequests: 1, windowMs: 60_000, partitionBy: 'global' } },
    });

    await handler(listToolsRequest());
    const limited = await handler(listToolsRequest());

    expect(limited.status).toBe(429);
    expect(logs[logs.length - 1]).toEqual(expect.objectContaining({ status: 'error', status_code: 429 }));
  });

  it('answers without waiting for a slow onRequestComplete', async () => {
    const handler = await serverLogging(() => new Promise<void>(() => undefined), {});

    const outcome = await Promise.race([
      handler(listToolsRequest()).then((response) => response.status),
      new Promise<string>((resolve) => setTimeout(() => resolve('held'), 3000)),
    ]);

    expect(outcome).not.toBe('held');
  });
});
