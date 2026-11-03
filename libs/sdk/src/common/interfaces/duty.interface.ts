/** What a duty's `run()` receives. */
export interface DutyRunContext {
  /** Aborted when this process loses the duty's lease or shuts down: stop the run early when it fires. */
  readonly signal: AbortSignal;
}

/** A `@Duty` class: `run()` is called every interval in the one process that holds the duty's lease. */
export interface DutyInterface {
  run(context: DutyRunContext): void | Promise<void>;
}
