/**
 * OtlpSink — exports structured log entries via OTLP HTTP to any
 * OTel-compatible backend (Coralogix, Datadog, Logz.io, Grafana, etc.).
 *
 * Posts to `{endpoint}/v1/logs` using the OTel Logs data model.
 * Batches entries and flushes periodically or on demand.
 *
 * @example
 * ```typescript
 * // Coralogix
 * { type: 'otlp', endpoint: 'https://ingress.coralogix.com:443',
 *   headers: { Authorization: 'Bearer CX_API_KEY' } }
 *
 * // Datadog
 * { type: 'otlp', endpoint: 'https://http-intake.logs.datadoghq.com',
 *   headers: { 'DD-API-KEY': 'YOUR_KEY' } }
 *
 * // Logz.io
 * { type: 'otlp', endpoint: 'https://otlp-listener.logz.io:8071',
 *   headers: { Authorization: 'Bearer SHIPPING_TOKEN' } }
 *
 * // Local OTLP collector
 * { type: 'otlp', endpoint: 'http://localhost:4318' }
 * ```
 */

import type { LogSink } from '../log-sink.interface';
import type { StructuredLogEntry } from '../structured-log.types';

export interface OtlpSinkOptions {
  /** OTLP endpoint (e.g., 'http://localhost:4318'). Path '/v1/logs' is appended. */
  endpoint: string;

  /** Custom headers (for auth tokens, API keys) */
  headers?: Record<string, string>;

  /** Max batch size before auto-flush (default: 100) */
  batchSize?: number;

  /** Flush interval in ms (default: 5000) */
  flushIntervalMs?: number;

  /** Service name for resource identification */
  serviceName?: string;
}

/**
 * OtlpSink — batches structured log entries and exports via OTLP HTTP.
 */
export class OtlpSink implements LogSink {
  private batch: StructuredLogEntry[] = [];
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly batchSize: number;
  private readonly serviceName: string;
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(options: OtlpSinkOptions) {
    const base = options.endpoint.replace(/\/+$/, '');
    this.endpoint = `${base}/v1/logs`;
    this.headers = {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    };
    this.batchSize = options.batchSize ?? 100;
    this.serviceName =
      options.serviceName ??
      (typeof process !== 'undefined' ? process.env?.['OTEL_SERVICE_NAME'] : undefined) ??
      'frontmcp-server';

    const flushMs = options.flushIntervalMs ?? 5000;
    if (flushMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flush();
      }, flushMs);
      // Prevent timer from keeping the process alive
      if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
        (this.flushTimer as { unref: () => void }).unref();
      }
    }
  }

  write(entry: StructuredLogEntry): void {
    this.batch.push(entry);
    if (this.batch.length >= this.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const entries = this.batch.splice(0);
    const payload = this.buildOtlpPayload(entries);

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
      });
    } catch {
      // Log export failures must not break the application
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flush();
  }

  /**
   * Build OTLP Logs JSON payload per the OTel spec.
   *
   * @see https://opentelemetry.io/docs/specs/otlp/#otlphttp-request
   * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/
   */
  private buildOtlpPayload(entries: StructuredLogEntry[]): OtlpLogsPayload {
    return {
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }],
          },
          scopeLogs: [
            {
              scope: { name: '@frontmcp/observability' },
              logRecords: entries.map((entry) => this.entryToLogRecord(entry)),
            },
          ],
        },
      ],
    };
  }

  private entryToLogRecord(entry: StructuredLogEntry): OtlpLogRecord {
    const record: OtlpLogRecord = {
      timeUnixNano: String(new Date(entry.timestamp).getTime() * 1_000_000),
      severityNumber: entry.severity_number,
      severityText: entry.level.toUpperCase(),
      body: { stringValue: entry.message },
      attributes: [],
    };

    // Trace correlation
    if (entry.trace_id) {
      record.traceId = entry.trace_id;
    }
    if (entry.span_id) {
      record.spanId = entry.span_id;
    }
    if (entry.trace_flags !== undefined) {
      record.flags = entry.trace_flags;
    }

    // Standard attributes
    if (entry.request_id) {
      record.attributes!.push({ key: 'frontmcp.request.id', value: { stringValue: entry.request_id } });
    }
    if (entry.session_id_hash) {
      record.attributes!.push({ key: 'mcp.session.id', value: { stringValue: entry.session_id_hash } });
    }
    if (entry.scope_id) {
      record.attributes!.push({ key: 'frontmcp.scope.id', value: { stringValue: entry.scope_id } });
    }
    if (entry.flow_name) {
      record.attributes!.push({ key: 'frontmcp.flow.name', value: { stringValue: entry.flow_name } });
    }
    if (entry.prefix) {
      record.attributes!.push({ key: 'log.prefix', value: { stringValue: entry.prefix } });
    }
    if (entry.elapsed_ms !== undefined) {
      record.attributes!.push({ key: 'elapsed_ms', value: { intValue: String(entry.elapsed_ms) } });
    }

    // Error attributes
    if (entry.error) {
      record.attributes!.push({ key: 'error.type', value: { stringValue: entry.error.type } });
      record.attributes!.push({ key: 'error.message', value: { stringValue: entry.error.message } });
      if (entry.error.code) {
        record.attributes!.push({ key: 'error.code', value: { stringValue: entry.error.code } });
      }
      if (entry.error.stack) {
        record.attributes!.push({ key: 'error.stack', value: { stringValue: entry.error.stack } });
      }
    }

    // User attributes
    if (entry.attributes) {
      for (const [key, value] of Object.entries(entry.attributes)) {
        if (typeof value === 'string') {
          record.attributes!.push({ key, value: { stringValue: value } });
        } else if (typeof value === 'number') {
          record.attributes!.push({ key, value: { intValue: String(value) } });
        } else if (typeof value === 'boolean') {
          record.attributes!.push({ key, value: { boolValue: value } });
        }
      }
    }

    return record;
  }
}

// OTLP JSON types (minimal, per spec)
interface OtlpLogsPayload {
  resourceLogs: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeLogs: Array<{
      scope: { name: string };
      logRecords: OtlpLogRecord[];
    }>;
  }>;
}

interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes?: OtlpAttribute[];
  traceId?: string;
  spanId?: string;
  flags?: number;
}

interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean };
}
