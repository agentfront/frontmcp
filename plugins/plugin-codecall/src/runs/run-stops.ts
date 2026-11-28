/** How a held answer ends: handed to the script, or moot because another call's `needs_approval` already stopped the run. */
export type StopRelease = 'released' | 'moot';

/** What {@link RunStops} reads of its run: the calls running in their tools, and the calls that reached the host. */
export interface RunStopsJournal {
  /** How many calls are running in their tools now. */
  running(): number;
  /** Settles at the next change: a call starts or settles, or the run ends. */
  changed(): Promise<void>;
  /** How many calls reached the host so far. */
  arrivals(): number;
}

/**
 * How many turns of the event loop pass with nothing running and no new call before the run counts as settled:
 * Enclave hands the script one result a turn, in call order, and a result can start another call.
 */
const QUIET_TURNS = 3;

const nextTurn: () => Promise<void> =
  typeof setImmediate === 'function'
    ? () => new Promise((resolve) => setImmediate(resolve))
    : () => new Promise((resolve) => setTimeout(resolve, 0));

interface HeldAnswer {
  callIndex: number;
  /** A `needs_approval`, which Enclave answers by stopping the run; any other answer is thrown into the script. */
  halts: boolean;
  /** When the answer must be given at the latest (epoch ms): before Enclave's review hook times out. */
  deadline: number;
  release: (how: StopRelease) => void;
}

/**
 * The answers that stop a run before their call ran (a `needs_approval`, a refusal, or a call the call flow refused
 * before its tool), held while other calls of the run, a `parallel()`'s, still run: a call that ran is then recorded
 * with its result, and a resumed run answers it from the record instead of running it again.
 *
 * Once nothing runs and no call reached the host for a few turns, or a held answer's deadline comes, the answers go
 * out together, in call order. The lowest `needs_approval` among them goes first, and Enclave stops the run with it;
 * the other answers are then moot: the script never gets them, and their calls are asked again on resume. Without a
 * `needs_approval`, every answer goes to the script, as it would have without the hold.
 */
export class RunStops {
  private readonly held = new Map<number, HeldAnswer>();
  private asking = 0;
  private settling = false;
  private halted = false;
  private haltTaken?: Promise<void>;
  private closed = false;
  private readonly wakers = new Set<() => void>();

  constructor(private readonly journal: RunStopsJournal) {}

  /** Whether an answer is held now. */
  get holding(): boolean {
    return this.held.size > 0;
  }

  /** Counts a call whose call-phase hooks are asked now; the returned function ends it. */
  asked(): () => void {
    this.asking++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.asking--;
      this.wake();
    };
  }

  /**
   * Holds the answer for the call at `callIndex` until the other calls of the run settle; resolves with how it ends.
   * A run that already stopped, or ended, answers `moot` at once.
   */
  hold(callIndex: number, halts: boolean, deadline = Number.POSITIVE_INFINITY): Promise<StopRelease> {
    if (this.closed || this.halted) return Promise.resolve('moot');
    return new Promise((release) => {
      this.held.set(callIndex, { callIndex, halts, deadline, release });
      if (this.settling) return;
      this.settling = true;
      void this.settle();
    });
  }

  /** Waits until a `needs_approval` that went out took effect, so a call allowed meanwhile does not reach its tool. */
  async afterHalt(): Promise<void> {
    if (this.haltTaken) await this.haltTaken;
  }

  /** Ends the run's holds: every answer still held is moot. */
  close(): void {
    this.closed = true;
    const held = [...this.held.values()];
    this.held.clear();
    for (const answer of held) answer.release('moot');
    this.wake();
  }

  private wake(): void {
    const wakers = [...this.wakers];
    this.wakers.clear();
    for (const waker of wakers) waker();
  }

  private deadline(): number {
    return Math.min(...[...this.held.values()].map((answer) => answer.deadline));
  }

  private busy(): boolean {
    return this.asking > 0 || this.journal.running() > 0;
  }

  private async settle(): Promise<void> {
    let quietTurns = 0;
    let arrivals = this.journal.arrivals();
    while (!this.closed && this.held.size > 0 && Date.now() < this.deadline()) {
      if (this.busy()) {
        quietTurns = 0;
        await this.changedBefore(this.deadline());
        continue;
      }
      await nextTurn();
      const now = this.journal.arrivals();
      if (now !== arrivals || this.busy()) {
        arrivals = now;
        quietTurns = 0;
      } else if (++quietTurns >= QUIET_TURNS) {
        break;
      }
    }
    this.settling = false;
    this.release();
  }

  /** Settles at the next change (a call starts or settles, a hook answers, the run ends), or at `deadline`. */
  private async changedBefore(deadline: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waker: (() => void) | undefined;
    const woken = new Promise<void>((resolve) => {
      waker = resolve;
      this.wakers.add(resolve);
    });
    const due = Number.isFinite(deadline)
      ? new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
        })
      : undefined;
    try {
      await Promise.race([this.journal.changed(), woken, ...(due ? [due] : [])]);
    } finally {
      clearTimeout(timer);
      if (waker) this.wakers.delete(waker);
    }
  }

  private release(): void {
    const held = [...this.held.values()].sort((left, right) => left.callIndex - right.callIndex);
    this.held.clear();
    const lead = held.find((answer) => answer.halts);
    if (!lead) {
      for (const answer of held) answer.release('released');
      return;
    }
    this.halted = true;
    lead.release('released');
    // Enclave stops the run within the microtasks that follow the answer; a turn later the others reach no script.
    this.haltTaken = nextTurn();
    void this.haltTaken.then(() => {
      for (const answer of held) if (answer !== lead) answer.release('moot');
    });
  }
}
