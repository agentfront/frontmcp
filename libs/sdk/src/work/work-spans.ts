/**
 * Work spans: the units of work a server runs besides its MCP calls, so that a tool such as the stall detector of
 * `@frontmcp/observability` can name the work in flight when the event loop stalls. The SDK opens one for each
 * `@HttpRoute` request, each `@Duty` run and each `@Worker` run; `trackWork()` opens one for any other work.
 */

/** What a work span runs: an `@HttpRoute` request, a `@Duty` run, a `@Worker` run, or work `trackWork()` names. */
export type WorkKind = 'http' | 'duty' | 'worker' | 'work';

export interface WorkSpan {
  readonly kind: WorkKind;
  /**
   * What runs: a route's method and declared path (`GET /board/:id`), a duty's or a worker's name, or the label given
   * to `trackWork()`.
   */
  readonly name: string;
}

/** Follows work spans: `begin` is called as a span opens, and returns what to call when it ends. */
export interface WorkTracker {
  begin(span: WorkSpan): () => void;
}

/** The trackers of the process, kept on `globalThis` so two copies of the SDK in one process share them. */
const TRACKERS_KEY = Symbol.for('frontmcp:work-trackers');

function trackers(): Set<WorkTracker> {
  const holder = globalThis as { [TRACKERS_KEY]?: Set<WorkTracker> };
  holder[TRACKERS_KEY] ??= new Set<WorkTracker>();
  return holder[TRACKERS_KEY];
}

const NOTHING_TO_END = (): void => undefined;

/** Open a span of `kind` named `name` with every tracker; the function it returns ends it, once. */
export function openWorkSpan(kind: WorkKind, name: string): () => void {
  const followed = trackers();
  if (followed.size === 0) return NOTHING_TO_END;
  const span: WorkSpan = { kind, name };
  const ends: Array<() => void> = [];
  for (const tracker of followed) {
    try {
      ends.push(tracker.begin(span));
    } catch {
      // A tracker that fails must not fail the work it follows.
    }
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    for (const end of ends) {
      try {
        end();
      } catch {
        // As above: the work already ran.
      }
    }
  };
}

/** Run `work` in a span of `kind` named `name`, which ends when it returns, throws or settles. */
export async function withWorkSpan<T>(kind: WorkKind, name: string, work: () => T | PromiseLike<T>): Promise<T> {
  const end = openWorkSpan(kind, name);
  try {
    return await work();
  } finally {
    end();
  }
}

/**
 * Mark a unit of work outside an MCP call, such as a timer's callback or a batch of background ingest, so a stall
 * that happens while it runs names it (`work <label>`). Call the function it returns when the work ends, in a
 * `finally`; calling it again does nothing. Keep labels to a fixed set: each one is a label value of the stall metric.
 *
 * @example
 * ```typescript
 * const end = trackWork('ingest:batch');
 * try {
 *   await ingest(batch);
 * } finally {
 *   end();
 * }
 * ```
 */
export function trackWork(label: string): () => void {
  return openWorkSpan('work', String(label));
}

/** Follow every work span the process opens from now on; returns the function that stops following them. */
export function registerWorkTracker(tracker: WorkTracker): () => void {
  const followed = trackers();
  followed.add(tracker);
  return () => {
    followed.delete(tracker);
  };
}
