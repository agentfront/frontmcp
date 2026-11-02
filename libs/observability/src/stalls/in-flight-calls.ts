/** The requests whose entries a stall can be blamed on. */
export type CallMethod = 'tools/call' | 'resources/read' | 'prompts/get';

export interface CallIdentity {
  method: CallMethod;
  /** The entry's full name, its app's id first (`reports:export_rows`). */
  entry: string;
  /** The first 12 hex characters of the session's tracing id, never the session id itself. */
  session?: string;
}

export interface CallRecord extends CallIdentity {
  startedAt: number;
  endedAt?: number;
}

/** The calls running now, and the ones that ended recently enough to have run during a stall still being measured. */
export class InFlightCalls {
  private readonly records = new Set<CallRecord>();

  constructor(private readonly now: () => number) {}

  /**
   * Runs `body` as a call in flight. The call ends when `body` settles, whatever its outcome, or, when
   * `stillRunning()` then returns a promise (an execution a timeout left running), when that promise settles.
   */
  async track(call: CallIdentity, body: () => Promise<void>, stillRunning: () => unknown = () => undefined) {
    const record: CallRecord = { ...call, startedAt: this.now() };
    this.records.add(record);
    const end = () => {
      record.endedAt ??= this.now();
    };
    try {
      await body();
    } finally {
      const execution = stillRunning();
      if (execution instanceof Promise) execution.then(end, end);
      else end();
    }
  }

  running(): CallRecord[] {
    return [...this.records].filter((record) => record.endedAt === undefined).map((record) => ({ ...record }));
  }

  /** The calls that ran at some point between `from` and `to`. */
  during(from: number, to: number): CallRecord[] {
    return [...this.records]
      .filter((record) => record.startedAt <= to && (record.endedAt ?? to) >= from)
      .map((record) => ({ ...record }));
  }

  /** Forgets the calls that ended before `time`. */
  prune(time: number): void {
    for (const record of this.records) {
      if (record.endedAt !== undefined && record.endedAt < time) this.records.delete(record);
    }
  }
}
