/** A `POST` to the publish endpoint of a real server (`createFetchHandler()`) ends its span by how it was answered. */
import 'reflect-metadata';

import { diag, DiagLogLevel, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

import { App, event, FrontMcpInstance, LogLevel, z } from '@frontmcp/sdk';
import { bytesToHex, hmacSha256 } from '@frontmcp/utils';

import ObservabilityPlugin from '../plugin/observability.plugin';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
diag.setLogger({ debug() {}, info() {}, warn() {}, error() {}, verbose() {} }, DiagLogLevel.NONE);
trace.setGlobalTracerProvider(provider);

const SECRET = 'publish-endpoint-secret-of-32-chars!';
const encoder = new TextEncoder();
const orderCreated = event({ name: 'order.created', payloadSchema: { orderId: z.string() } });

@App({ id: 'shop', name: 'Shop', events: [orderCreated] })
class ShopApp {}

const order = { name: 'order.created', data: { orderId: 'o-1' } };
let signedSecondsAgo = 0;

/** A publish request signed with the endpoint's secret, unless `headers` replace its signature or timestamp. */
function publishRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const text = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000) - signedSecondsAgo++);
  const signature = bytesToHex(hmacSha256(encoder.encode(SECRET), encoder.encode(`${timestamp}.${text}`)));
  return new Request('https://shop.example.com/events/publish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-frontmcp-timestamp': timestamp,
      'x-frontmcp-signature': `v1=${signature}`,
      ...headers,
    },
    body: text,
  });
}

describe('events/publish-http telemetry', () => {
  let handler: (request: Request) => Promise<Response>;

  /** Sends a publish request and gives its status with the span the endpoint recorded for it. */
  async function publish(request: Request): Promise<{ status: number; span: ReadableSpan | undefined }> {
    exporter.reset();
    const response = await handler(request);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const span = exporter.getFinishedSpans().find((finished) => finished.name === 'events/publish-http');
    return { status: response.status, span };
  }

  beforeAll(async () => {
    handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'shop', version: '1.0.0' },
      apps: [ShopApp],
      logging: { level: LogLevel.Off },
      events: { publishEndpoint: { enabled: true, secret: SECRET } },
      plugins: [ObservabilityPlugin.init({ tracing: {} })],
    });
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  it.each([
    ['a bad signature', publishRequest(order, { 'x-frontmcp-signature': `v1=${'0'.repeat(64)}` }), 401],
    ['a stale timestamp', publishRequest(order, { 'x-frontmcp-timestamp': '1700000000' }), 401],
    ['an invalid body', publishRequest({ name: 'order.created' }), 400],
    ['an unknown event', publishRequest({ name: 'order.cancelled', data: {} }), 404],
    ['data that does not match the payload schema', publishRequest({ ...order, data: { orderId: 7 } }), 422],
  ])('ends the span of a publish refused for %s with ERROR and the HTTP status', async (_label, request, status) => {
    const refused = await publish(request);

    expect(refused.status).toBe(status);
    expect(refused.span?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: expect.stringContaining(`HTTP ${status}: `),
    });
    expect(refused.span?.events.find((recorded) => recorded.name === 'exception')?.attributes).toMatchObject({
      'exception.type': 'EVENT_PUBLISH_REFUSED',
    });
  });

  it('ends the span of an accepted publish, and of a repeated eventId, with OK', async () => {
    const accepted = await publish(publishRequest({ ...order, eventId: 'repeat-1' }));
    const repeated = await publish(publishRequest({ ...order, data: { orderId: 'o-2' }, eventId: 'repeat-1' }));

    expect(accepted.status).toBe(202);
    expect(accepted.span?.status.code).toBe(SpanStatusCode.OK);
    expect(repeated.status).toBe(202);
    expect(repeated.span?.status.code).toBe(SpanStatusCode.OK);
  });
});
