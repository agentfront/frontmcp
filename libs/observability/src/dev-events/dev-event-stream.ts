import { appendFile, dirname, ensureDir } from '@frontmcp/utils';

import type { CallMethod } from '../stalls/in-flight-calls';
import type { StallReport } from '../stalls/stall-detector';

/** A call that ended: how long it took and how it failed; never its input or its answer. */
export interface DevCallEvent {
  type: 'call';
  at: string;
  method: CallMethod;
  /** The entry's full name, the tool name a call asked for when no tool matched it, or `''`. */
  entry: string;
  durationMs: number;
  outcome: 'ok' | 'error';
  error?: { type: string; code?: string };
  session?: string;
}

export interface DevStallEvent extends StallReport {
  type: 'stall';
  at: string;
}

export type DevEvent = DevCallEvent | DevStallEvent;

/** Where dev events go. `write` gets the events of one batch, in order; a throw or rejection is logged once. */
export interface DevEventSink {
  readonly name?: string;
  write(events: readonly DevEvent[]): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface DevEventStreamOptions {
  /** How many events wait for the sinks at most; past it, new events are dropped. */
  maxQueue: number;
  logger: { warn(message: string): void };
}

/** The `__frontmcp` message a dev parent receives over IPC. */
export const DEV_EVENTS_IPC_MESSAGE = 'dev-events';

/** Appends each event to a file as one JSON line. */
export class JsonlFileSink implements DevEventSink {
  readonly name = 'file';
  private folderReady?: Promise<void>;

  constructor(readonly path: string) {}

  async write(events: readonly DevEvent[]): Promise<void> {
    this.folderReady ??= ensureDir(dirname(this.path));
    await this.folderReady;
    await appendFile(this.path, events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  }
}

/** Sends the events to the process that started this one with an IPC channel, such as `frontmcp dev`. */
export class IpcDevEventSink implements DevEventSink {
  readonly name = 'ipc';

  write(events: readonly DevEvent[]): Promise<void> {
    const send = process.send;
    if (typeof send !== 'function' || !process.connected) throw new Error('no IPC channel to the dev parent');
    return new Promise((resolve, reject) => {
      send.call(process, { __frontmcp: DEV_EVENTS_IPC_MESSAGE, events }, (error: Error | null) =>
        error ? reject(error) : resolve(),
      );
    });
  }
}

/** Queues dev events and writes them to its sinks off the call path; `emit` never waits. */
export class DevEventStream {
  private queue: DevEvent[] = [];
  private draining?: Promise<void>;
  private closed = false;
  private warnedFull = false;
  private readonly failedSinks = new Set<DevEventSink>();

  constructor(
    private readonly sinks: readonly DevEventSink[],
    private readonly options: DevEventStreamOptions,
  ) {}

  emit(event: DevEvent): void {
    if (this.closed) return;
    if (this.queue.length >= this.options.maxQueue) {
      if (!this.warnedFull) {
        this.warnedFull = true;
        this.options.logger.warn(
          `Dev events: the queue of ${this.options.maxQueue} events is full; new events are dropped until the sinks catch up`,
        );
      }
      return;
    }
    this.queue.push(event);
    this.draining ??= this.drain();
  }

  /** Resolves once every event emitted so far is written. */
  flush(): Promise<void> {
    return this.draining ?? Promise.resolve();
  }

  async onShutdown(): Promise<void> {
    while (this.draining) await this.draining;
    this.closed = true;
    await Promise.all(this.sinks.map((sink) => this.attempt(sink, () => sink.close?.())));
  }

  private async drain(): Promise<void> {
    await Promise.resolve();
    while (this.queue.length > 0) {
      const batch = this.queue;
      this.queue = [];
      await Promise.all(this.sinks.map((sink) => this.attempt(sink, () => sink.write(batch))));
    }
    this.draining = undefined;
  }

  private async attempt(sink: DevEventSink, run: () => unknown): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (this.failedSinks.has(sink)) return;
      this.failedSinks.add(sink);
      const reason = error instanceof Error ? error.message : String(error);
      this.options.logger.warn(
        `Dev events: the ${sink.name ?? 'custom'} sink failed (${reason}); its later failures are not logged`,
      );
    }
  }
}
