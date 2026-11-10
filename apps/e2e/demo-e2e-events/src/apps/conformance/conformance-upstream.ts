/** One change of the test upstream that `conformance.replayed` reads. */
export interface UpstreamChange {
  seq: number;
  topic: string;
}

/**
 * Test-only state that the conformance tools steer: an upstream `check()` reads, with the failures and gaps a healthy
 * upstream never produces, and the subjects whose access was revoked.
 */
class ConformanceState {
  readonly changes: UpstreamChange[] = [];
  /** Positions before this one are gone from the upstream, as after its retention window passed. */
  retainedFrom = 0;
  /** How many of the next `check()` calls throw. */
  failuresLeft = 0;
  /** Whether the next `check()` skips what is pending and reports a gap. */
  gapNext = false;
  readonly revokedSubjects = new Set<string>();

  /** Add `count` changes to the upstream for a topic. */
  append(topic: string, count: number): void {
    for (let index = 0; index < count; index++) this.changes.push({ seq: this.changes.length + 1, topic });
  }

  /** Forget everything, between tests. */
  reset(): void {
    this.changes.length = 0;
    this.retainedFrom = 0;
    this.failuresLeft = 0;
    this.gapNext = false;
    this.revokedSubjects.clear();
  }
}

export const conformanceState = new ConformanceState();
