/**
 * The hooks that ran before the current call of one of this app's tools, in the order they ran.
 */
class RunLog {
  private ran: string[] = [];

  record(hook: string): void {
    this.ran.push(hook);
  }

  take(): string[] {
    return this.ran.splice(0);
  }
}

export const runLog = new RunLog();
