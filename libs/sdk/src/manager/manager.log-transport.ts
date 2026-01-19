/**
 * ManagerLogTransport - Log transport that forwards events to ManagerService
 *
 * This transport integrates with the logging system and:
 * - For Trace logs: emits structured trace events for state construction
 * - For regular logs: emits log entries for connected clients
 *
 * Context is automatically enriched from AsyncLocalStorage (FrontMcpContextStorage).
 */

import { LogTransportInterface, LogRecord, LogLevel, TraceLogRecord, TraceEventType, LogTransport } from '../common';
import { FrontMcpContext } from '../context/frontmcp-context';
import { getRawContextStorage } from '../context/frontmcp-context-storage';
import type { ManagerService } from './manager.service';
import type { RequestEventData, SessionEventData, RegistryEventData, ServerEventData } from './manager.types';

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagerLogTransportOptions {
  /** Include log args in output (default: false to reduce noise) */
  includeLogArgs?: boolean;
  /** Maximum number of logs to buffer before manager is connected (default: 500) */
  maxBufferSize?: number;
}

const DEFAULT_OPTIONS: Required<ManagerLogTransportOptions> = {
  includeLogArgs: false,
  maxBufferSize: 500,
};

/**
 * Buffered log entry with captured context.
 * Stores both the log record and the context snapshot at the time of logging.
 */
interface BufferedLogEntry {
  rec: LogRecord;
  ctx: FrontMcpContext | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager Log Transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ManagerLogTransport forwards structured events to the ManagerService.
 *
 * All logs are received through the standard log() method:
 * - Trace logs (LogLevel.Trace) are converted to structured manager events
 * - Regular logs (Debug, Info, Warn, Error) are emitted as log events
 *
 * Context is automatically enriched from AsyncLocalStorage.
 */
@LogTransport({
  name: 'ManagerLogTransport',
  description: 'Forwards structured log events to ManagerService for socket distribution',
})
export class ManagerLogTransport extends LogTransportInterface {
  private readonly options: Required<ManagerLogTransportOptions>;
  private manager: ManagerService | null = null;
  /**
   * Buffer for logs received before manager is connected.
   * Logs are buffered with their context snapshot and flushed when connect() is called.
   */
  private logBuffer: BufferedLogEntry[] = [];

  constructor(options?: ManagerLogTransportOptions) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Connect this transport to a ManagerService.
   * Must be called before events will be forwarded.
   * Flushes any buffered logs that were received before connection.
   */
  connect(manager: ManagerService): void {
    this.manager = manager;

    // Flush buffered logs now that manager is connected
    this.flushBufferedLogs();
  }

  /**
   * Flush all buffered logs to the manager.
   * Called when manager is first connected.
   */
  private flushBufferedLogs(): void {
    if (!this.manager || this.logBuffer.length === 0) {
      return;
    }

    const bufferedLogs = this.logBuffer;
    this.logBuffer = [];

    for (const entry of bufferedLogs) {
      this.processLogRecord(entry.rec, entry.ctx);
    }
  }

  /**
   * Disconnect from the ManagerService.
   * Clears any buffered logs to prevent memory leaks.
   */
  disconnect(): void {
    this.manager = null;
    this.logBuffer = [];
  }

  /**
   * Check if connected to a ManagerService.
   */
  isConnected(): boolean {
    return this.manager !== null;
  }

  /**
   * Process incoming log record.
   *
   * Routes to appropriate handler based on log level:
   * - Trace logs → structured events for Manager
   * - Regular logs → log events for Manager
   *
   * If the manager is not connected yet, logs are buffered and will be
   * flushed when connect() is called. This ensures startup logs are captured.
   */
  log(rec: LogRecord): void {
    // Get context from AsyncLocalStorage (may be undefined if not in context)
    const ctx = getRawContextStorage().getStore();

    if (!this.manager) {
      // Buffer logs until manager is connected
      // Only buffer if we haven't exceeded the limit
      if (this.logBuffer.length < this.options.maxBufferSize) {
        this.logBuffer.push({ rec, ctx });
      }
      return;
    }

    this.processLogRecord(rec, ctx);
  }

  /**
   * Process a log record with its context.
   * Called both from log() for live logs and from flushBufferedLogs() for startup logs.
   */
  private processLogRecord(rec: LogRecord, ctx: FrontMcpContext | undefined): void {
    if (!this.manager) return;

    if (rec.level === LogLevel.Trace) {
      this.handleTraceEvent(rec as TraceLogRecord, ctx);
    } else {
      this.handleLogEntry(rec, ctx);
    }
  }

  /**
   * Handle structured trace events.
   *
   * Trace events are converted to appropriate ManagerEvent types:
   * - session:* → SessionEvent
   * - request:* → RequestEvent
   * - registry:* → RegistryEvent
   * - server:* → ServerEvent
   * - Others → Logged as trace events
   */
  private handleTraceEvent(rec: TraceLogRecord, ctx: FrontMcpContext | undefined): void {
    if (!this.manager) return;

    const scopeId = ctx?.scopeId ?? 'unknown';
    const eventType = rec.eventType;
    const data = rec.data ?? {};

    // Route based on event type prefix
    // Cast data to the appropriate type at the routing boundary
    if (eventType.startsWith('session:')) {
      this.handleSessionTrace(scopeId, eventType, data as unknown as SessionEventData, ctx);
    } else if (eventType.startsWith('request:')) {
      this.handleRequestTrace(scopeId, eventType, data as unknown as RequestEventData, ctx);
    } else if (eventType.startsWith('tool:')) {
      // Forward tool:execute and tool:complete events as request events for TUI metrics
      this.handleToolTrace(scopeId, eventType, data as unknown as RequestEventData, ctx);
    } else if (eventType.startsWith('server:')) {
      this.handleServerTrace(eventType, data as unknown as ServerEventData);
    } else if (eventType.startsWith('registry:plugin:')) {
      // Plugin registry emits trace events (not subscriptions like other registries)
      this.handlePluginRegistryTrace(scopeId, eventType, data as unknown as RegistryEventData);
    } else if (eventType.startsWith('registry:adapter:')) {
      // Adapter registry emits trace events (like plugin registry)
      this.handleAdapterRegistryTrace(scopeId, eventType, data as unknown as RegistryEventData);
    }
    // Other registry events are handled by direct registry subscriptions in ManagerService
  }

  /**
   * Handle tool trace events (tool:execute, tool:complete).
   * These are forwarded as trace events that preserve the original event type.
   */
  private handleToolTrace(
    scopeId: string,
    eventType: TraceEventType,
    data: RequestEventData,
    ctx: FrontMcpContext | undefined,
  ): void {
    if (!this.manager) return;

    // Emit as a trace event which preserves the event type for TUI metrics
    // The TUI's handle_trace_event matches on "tool:execute" and "tool:complete"
    this.manager.emitTraceEvent(scopeId, eventType, data, ctx?.sessionId, ctx?.requestId);
  }

  /**
   * Handle session trace events.
   */
  private handleSessionTrace(
    scopeId: string,
    eventType: TraceEventType,
    data: SessionEventData,
    ctx: FrontMcpContext | undefined,
  ): void {
    if (!this.manager) return;

    // Ensure sessionId is present, falling back to context or 'unknown'
    const sessionData: SessionEventData = {
      ...data,
      sessionId: data.sessionId ?? ctx?.sessionId ?? 'unknown',
    };

    // For session:connect, include auth info from context if available
    if (eventType === 'session:connect' && ctx) {
      const authInfo = ctx.authInfo;
      if (authInfo) {
        // Extract auth mode from claims or token type
        const user = authInfo.user as Record<string, unknown> | undefined;
        const mode = user?.['mode'] as string | undefined;
        if (mode && (mode === 'public' || mode === 'transparent' || mode === 'orchestrated')) {
          sessionData.authMode = mode as 'public' | 'transparent' | 'orchestrated';
        }
        // Extract user info
        const name = user?.['name'] as string | undefined;
        const email = user?.['email'] as string | undefined;
        if (name || email) {
          sessionData.authUser = { name, email };
        }
        // Check if anonymous (no token or anonymous token type)
        sessionData.isAnonymous = !authInfo.token || user?.['anonymous'] === true;
      }
    }

    this.manager.emitSessionEvent(
      scopeId,
      eventType as 'session:connect' | 'session:disconnect' | 'session:idle' | 'session:active',
      sessionData,
    );
  }

  /**
   * Handle request trace events.
   */
  private handleRequestTrace(
    scopeId: string,
    eventType: TraceEventType,
    data: RequestEventData,
    ctx: FrontMcpContext | undefined,
  ): void {
    if (!this.manager) return;

    // Ensure flowName is present, falling back to 'unknown'
    const requestData: RequestEventData = {
      ...data,
      flowName: data.flowName ?? 'unknown',
    };

    this.manager.emitRequestEvent(
      scopeId,
      eventType as 'request:start' | 'request:complete' | 'request:error',
      requestData,
      ctx?.sessionId,
      ctx?.requestId,
    );
  }

  /**
   * Handle server trace events.
   */
  private handleServerTrace(eventType: TraceEventType, data: ServerEventData): void {
    if (!this.manager) return;

    this.manager.emitServerEvent(
      eventType as 'server:starting' | 'server:ready' | 'server:error' | 'server:shutdown',
      data,
    );
  }

  /**
   * Handle plugin registry trace events.
   *
   * Plugin registry emits trace events (unlike other registries that use subscriptions).
   * This method converts those trace events into proper manager events.
   */
  private handlePluginRegistryTrace(scopeId: string, eventType: TraceEventType, data: RegistryEventData): void {
    if (!this.manager) return;

    this.manager.emitPluginRegistryEvent(scopeId, eventType, data);
  }

  /**
   * Handle adapter registry trace events.
   *
   * Adapter registry emits trace events (like plugin registry).
   * This method converts those trace events into proper manager events.
   */
  private handleAdapterRegistryTrace(scopeId: string, eventType: TraceEventType, data: RegistryEventData): void {
    if (!this.manager) return;

    this.manager.emitAdapterRegistryEvent(scopeId, eventType, data);
  }

  /**
   * Handle regular log entries.
   */
  private handleLogEntry(rec: LogRecord, ctx: FrontMcpContext | undefined): void {
    if (!this.manager) return;

    const scopeId = ctx?.scopeId ?? 'unknown';

    this.manager.emitLogEvent(
      scopeId,
      rec.levelName,
      rec.message,
      rec.prefix,
      this.options.includeLogArgs ? rec.args : undefined,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton instance for global access
// ─────────────────────────────────────────────────────────────────────────────

let globalTransport: ManagerLogTransport | null = null;

/**
 * Get or create the global ManagerLogTransport instance.
 */
export function getManagerLogTransport(options?: ManagerLogTransportOptions): ManagerLogTransport {
  if (!globalTransport) {
    globalTransport = new ManagerLogTransport(options);
  }
  return globalTransport;
}

/**
 * Reset the global ManagerLogTransport instance.
 * Primarily for testing.
 */
export function resetManagerLogTransport(): void {
  if (globalTransport) {
    globalTransport.disconnect();
    globalTransport = null;
  }
}
