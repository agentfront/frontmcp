/**
 * The gates that ran before the current `gate-order` call, in the order they ran.
 */
class GateLog {
  private ran: string[] = [];

  record(gate: string): void {
    this.ran.push(gate);
  }

  take(): string[] {
    return this.ran.splice(0);
  }
}

export const gateLog = new GateLog();
