/**
 * Options of `observability` that used to be accepted without effect: `logging: true` adds the NDJSON stdout sink,
 * `requestLogs.includeSummaries` summarizes each call's arguments and result, and `tracing.authSpans` records the
 * authentication of each HTTP request.
 */
import 'reflect-metadata';

import { diag, DiagLogLevel, trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { App, FrontMcpInstance, LogLevel, Prompt, PromptContext, Tool, ToolContext, z } from '@frontmcp/sdk';

import type { TracingOptions } from '../otel/otel.types';
import ObservabilityPlugin from '../plugin/observability.plugin';
import type { RequestLog } from '../request-log/request-log.types';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
diag.setLogger({ debug() {}, info() {}, warn() {}, error() {}, verbose() {} }, DiagLogLevel.NONE);
trace.setGlobalTracerProvider(provider);

@Tool({ name: 'weather', inputSchema: { city: z.string() }, outputSchema: { city: z.string(), celsius: z.number() } })
class Weather extends ToolContext {
  async execute({ city }: { city: string }) {
    this.logger.info('looked up the weather', { city });
    return { city, celsius: 21 };
  }
}

@Prompt({ name: 'greet', arguments: [{ name: 'name', required: true }] })
class Greet extends PromptContext {
  async execute(args: Record<string, string>) {
    return `Hello, ${args['name']}!`;
  }
}

@App({ id: 'desk', name: 'Desk', tools: [Weather], prompts: [Greet] })
class DeskApp {}

function rpc(method: string, params: Record<string, unknown>): Request {
  return new Request('https://desk.example.com/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      'mcp-name': String(params['name']),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    }),
  });
}

const weatherCall = () => rpc('tools/call', { name: 'weather', arguments: { city: 'Lisbon' } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => exporter.reset());
afterAll(() => provider.shutdown());

describe('requestLogs.includeSummaries', () => {
  async function logsOf(includeSummaries: boolean | undefined, request: Request): Promise<RequestLog[]> {
    const logs: RequestLog[] = [];
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      plugins: [
        ObservabilityPlugin.init({
          tracing: false,
          requestLogs: { includeSummaries, onRequestComplete: (log) => void logs.push(log) },
        }),
      ],
    });
    await handler(request);
    await settle();
    return logs;
  }

  it("summarizes a tool call's arguments and result, without their values", async () => {
    const [log] = await logsOf(true, weatherCall());

    expect(log.input_summary).toEqual({ keys: ['city'], bytes: Buffer.byteLength('{"city":"Lisbon"}') });
    expect(log.output_summary).toEqual(
      expect.objectContaining({ keys: ['city', 'celsius'], content_types: ['text'], is_error: false }),
    );
    expect(log.output_summary?.bytes).toBeGreaterThan(0);
    expect(JSON.stringify([log.input_summary, log.output_summary])).not.toContain('Lisbon');
  });

  it("summarizes a prompt's arguments and messages", async () => {
    const [log] = await logsOf(true, rpc('prompts/get', { name: 'greet', arguments: { name: 'Ada' } }));

    expect(log.input_summary).toEqual(expect.objectContaining({ keys: ['name'] }));
    expect(log.output_summary).toEqual(expect.objectContaining({ content_types: ['text'] }));
  });

  it('adds no summaries by default', async () => {
    const [log] = await logsOf(undefined, weatherCall());

    expect(log).not.toHaveProperty('input_summary');
    expect(log).not.toHaveProperty('output_summary');
  });
});

describe('tracing.authSpans', () => {
  async function spansOf(tracing: TracingOptions) {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      plugins: [ObservabilityPlugin.init({ tracing: { startupReport: false, ...tracing } })],
    });
    await handler(weatherCall());
    return exporter.getFinishedSpans();
  }

  it("records the request's authentication as a child of its HTTP span", async () => {
    const spans = await spansOf({});
    const auth = spans.find((span) => span.name === 'auth session:verify');
    const http = spans.find((span) => span.name === 'POST /');

    expect(auth?.attributes['frontmcp.auth.result']).toBe('anonymous');
    expect(auth?.parentSpanContext?.spanId).toBe(http?.spanContext().spanId);
  });

  it('records none with authSpans: false', async () => {
    const spans = await spansOf({ authSpans: false });

    expect(spans.map((span) => span.name)).not.toContain('auth session:verify');
  });
});

describe('observability.logging: true', () => {
  it('writes each log entry as a line of NDJSON on stdout', async () => {
    const written: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      const handler = await FrontMcpInstance.createFetchHandler({
        info: { name: 'desk', version: '1.0.0' },
        apps: [DeskApp],
        logging: { level: LogLevel.Info, enableConsole: false },
        observability: { tracing: false, logging: true },
      });
      await handler(weatherCall());
    } finally {
      write.mockRestore();
    }

    const entries = written
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as { message?: string; level?: string; attributes?: Record<string, unknown> });
    expect(entries).toContainEqual(
      expect.objectContaining({ level: 'info', message: 'looked up the weather', attributes: { city: 'Lisbon' } }),
    );
  });
});
