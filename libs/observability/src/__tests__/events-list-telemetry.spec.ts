/** `events/list` on a real server (`createFetchHandler()`) is traced like the other list requests. */
import 'reflect-metadata';

import { diag, DiagLogLevel, trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { App, event, FrontMcpInstance, LogLevel, Tool, ToolContext, z } from '@frontmcp/sdk';

import ObservabilityPlugin from '../plugin/observability.plugin';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
diag.setLogger({ debug() {}, info() {}, warn() {}, error() {}, verbose() {} }, DiagLogLevel.NONE);
trace.setGlobalTracerProvider(provider);

const orderCreated = event({ name: 'order.created', payloadSchema: { orderId: z.string() } });

/** Stands in for the part of a server that performs webhook delivery. */
@Tool({ name: 'enable_webhook_delivery', inputSchema: {} })
class EnableWebhookDelivery extends ToolContext {
  async execute() {
    this.scope.events?.enableDeliveryMode('webhook');
    return 'enabled';
  }
}

@App({ id: 'shop', name: 'Shop', tools: [EnableWebhookDelivery], events: [orderCreated] })
class ShopApp {}

function request(method: string, params: Record<string, unknown> = {}): Request {
  const name = typeof params['name'] === 'string' ? { 'mcp-name': params['name'] } : undefined;
  return new Request('https://shop.example.com/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...name,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    }),
  });
}

describe('events/list telemetry', () => {
  afterAll(async () => {
    await provider.shutdown();
  });

  it('records an events/list span with the stage that filters by authorities', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'shop', version: '1.0.0' },
      apps: [ShopApp],
      logging: { level: LogLevel.Off },
      plugins: [ObservabilityPlugin.init({ tracing: {} })],
    });
    await handler(request('tools/call', { name: 'enable_webhook_delivery', arguments: {} }));
    exporter.reset();

    const listed = await (await handler(request('events/list'))).json();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(listed.result.events.map((definition: { name: string }) => definition.name)).toEqual(['order.created']);
    const span = exporter.getFinishedSpans().find((finished) => finished.name === 'events/list');
    expect(span?.attributes['frontmcp.flow.name']).toBe('events/list');
    expect(span?.events.map((stage) => stage.name)).toContain('stage.filterByAuthorities');
  });
});
