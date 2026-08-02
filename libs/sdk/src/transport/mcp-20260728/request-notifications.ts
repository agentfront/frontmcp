/**
 * Request-scoped notifications for protocol 2026-07-28.
 *
 * Two rules from SEP-2575 shape this:
 *
 * - `notifications/progress` and `notifications/message` flow on the response
 *   stream of the request they relate to — never on the `subscriptions/listen`
 *   stream, and never on a session channel (there are no sessions).
 * - `logging/setLevel` is gone. The client opts in per request via
 *   `_meta["io.modelcontextprotocol/logLevel"]`, and a server **MUST NOT** emit
 *   `notifications/message` for a request that omitted it.
 *
 * The sink is attached to the `FrontMcpContext` for the duration of one
 * dispatch, so `this.notify()` / `this.progress()` deep inside an entry reach it
 * without any session lookup.
 */
import { type LoggingLevel } from '@frontmcp/protocol';

/** MCP severity order, least to most severe (RFC 5424). */
const LEVEL_ORDER: LoggingLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

/** True when `level` is at least as severe as the client's requested minimum. */
export function meetsLogLevel(level: LoggingLevel, minimum: LoggingLevel): boolean {
  const at = LEVEL_ORDER.indexOf(level);
  const min = LEVEL_ORDER.indexOf(minimum);
  if (at === -1 || min === -1) return true;
  return at >= min;
}

export interface QueuedRequestNotification {
  method: string;
  params: Record<string, unknown>;
}

/**
 * Collects notifications raised while handling one request and hands them to
 * the transport in arrival order.
 *
 * Deliberately unbounded-but-drained: the transport consumes as it streams, and
 * a request that ends without streaming simply discards what it buffered (a
 * client that asked for neither logs nor progress gets neither).
 */
export class RequestNotificationSink {
  private readonly queue: QueuedRequestNotification[] = [];
  private wake: (() => void) | undefined;
  private finished = false;

  constructor(
    /** Minimum severity the client opted into, or undefined for "no logs". */
    private readonly logLevel: LoggingLevel | undefined,
    /** Progress token from `_meta`, or undefined for "no progress". */
    private readonly progressToken: string | number | undefined,
  ) {}

  /** True when the client opted into anything at all. */
  get active(): boolean {
    return this.logLevel !== undefined || this.progressToken !== undefined;
  }

  /**
   * Queue a log message.
   *
   * Dropped outright when the client did not set `logLevel` — the spec makes
   * that a MUST NOT, not a preference.
   */
  log(level: LoggingLevel, logger: string | undefined, data: unknown): boolean {
    if (this.logLevel === undefined) return false;
    if (!meetsLogLevel(level, this.logLevel)) return false;

    this.push('notifications/message', {
      level,
      ...(logger ? { logger } : {}),
      data,
    });
    return true;
  }

  /** Queue a progress notification, if the client supplied a progress token. */
  progress(progress: number, total?: number, message?: string): boolean {
    if (this.progressToken === undefined) return false;

    this.push('notifications/progress', {
      progressToken: this.progressToken,
      progress,
      ...(total === undefined ? {} : { total }),
      ...(message === undefined ? {} : { message }),
    });
    return true;
  }

  private push(method: string, params: Record<string, unknown>): void {
    if (this.finished) return;
    this.queue.push({ method, params });
    this.wake?.();
  }

  /** Everything queued so far, cleared from the sink. */
  drain(): QueuedRequestNotification[] {
    return this.queue.splice(0, this.queue.length);
  }

  /** Signal that no further notifications will be raised. */
  close(): void {
    this.finished = true;
    this.wake?.();
  }

  /**
   * Wait until something is queued or the sink closes.
   *
   * Returns immediately when work is already pending, so a fast producer never
   * makes the consumer sleep on a non-empty queue.
   */
  async waitForActivity(): Promise<void> {
    if (this.queue.length > 0 || this.finished) return;
    await new Promise<void>((resolve) => {
      this.wake = () => {
        this.wake = undefined;
        resolve();
      };
    });
  }

  get closed(): boolean {
    return this.finished;
  }
}
