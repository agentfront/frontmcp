const encoder = new TextEncoder();
const HEARTBEAT = encoder.encode(': keep-alive\n\n');

export interface SseRouteStreamOptions {
  /** Makes the view to send: at once, then after each burst of publishes; `undefined` sends nothing. */
  produce: () => Promise<unknown>;
  /** Starts listening to the route's topics and returns the function that stops. */
  subscribe: (listener: () => void) => () => void;
  /** Publishes within this window make one view. */
  coalesceMs: number;
  /** A comment line is sent after this long without a view, so proxies keep the connection open. */
  heartbeatMs: number;
  onError: (error: unknown) => void;
  onClose?: () => void;
}

/** One `data:` event: an object as JSON, a string as one data line per line. */
export function formatSseEvent(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `${text
    .split(/\r\n|\r|\n/)
    .map((line) => `data: ${line}`)
    .join('\n')}\n\n`;
}

/**
 * The body of an SSE route: the route's view, sent at once and again after each burst of publishes on its topics.
 * Only the latest view waits for a reader that falls behind, so a slow client gets the current state, not a backlog.
 * Ends when the client leaves (`return()`) or the server stops (`close()`).
 */
export class SseRouteStream implements AsyncIterableIterator<Uint8Array> {
  private pending?: Uint8Array;
  private waiting?: (result: IteratorResult<Uint8Array>) => void;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;
  private producing = false;
  private dirty = false;
  private closed = false;

  constructor(private readonly options: SseRouteStreamOptions) {
    this.unsubscribe = options.subscribe(() => this.schedule());
    this.heartbeat = setInterval(() => this.offer(HEARTBEAT, false), options.heartbeatMs);
    this.heartbeat.unref?.();
    void this.produce();
  }

  next(): Promise<IteratorResult<Uint8Array>> {
    const pending = this.pending;
    if (pending !== undefined) {
      this.pending = undefined;
      return Promise.resolve({ value: pending, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => (this.waiting = resolve));
  }

  return(): Promise<IteratorResult<Uint8Array>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    clearInterval(this.heartbeat);
    clearTimeout(this.timer);
    this.pending = undefined;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
    this.options.onClose?.();
  }

  private schedule(): void {
    if (this.closed || this.timer) return;
    if (this.producing) {
      this.dirty = true;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.produce();
    }, this.options.coalesceMs);
  }

  private async produce(): Promise<void> {
    this.producing = true;
    this.dirty = false;
    try {
      const view = await this.options.produce();
      if (view !== undefined) this.offer(encoder.encode(formatSseEvent(view)), true);
    } catch (error) {
      this.options.onError(error);
    } finally {
      this.producing = false;
      if (this.dirty) this.schedule();
    }
  }

  private offer(chunk: Uint8Array, isView: boolean): void {
    if (this.closed) return;
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value: chunk, done: false });
      return;
    }
    if (isView || this.pending === undefined) this.pending = chunk;
  }
}
