import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

/** Registered when this module loads, before the server starts, so observability records into this exporter. */
const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));

interface RecordedRequestLog {
  tool_name?: string;
  status?: string;
  error?: { code?: string };
}

const requestLogs: RecordedRequestLog[] = [];

export function recordRequestLog(log: unknown): void {
  requestLogs.push(log as RecordedRequestLog);
}

const statusOf = (span: ReadableSpan) => (span.status.code === SpanStatusCode.ERROR ? 'error' : 'ok');

/** For each finished span of the tool, its status and the status of its `tools/call` span, or 'open'. */
export function callSpanStatuses(toolName: string): Array<{ tool: string; call: string }> {
  const finished = exporter.getFinishedSpans();
  return finished
    .filter((span) => span.name === `tool ${toolName}`)
    .map((toolSpan) => {
      const callSpan = finished.find((span) => span.spanContext().spanId === toolSpan.parentSpanContext?.spanId);
      return { tool: statusOf(toolSpan), call: callSpan ? statusOf(callSpan) : 'open' };
    });
}

export function toolRequestLogs(toolName: string): Array<{ status: string; errorCode?: string }> {
  return requestLogs
    .filter((log) => log.tool_name === toolName)
    .map((log) => ({ status: String(log.status), errorCode: log.error?.code }));
}
