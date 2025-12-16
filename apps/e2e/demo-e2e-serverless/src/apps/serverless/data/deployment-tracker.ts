export type InvocationRecord = {
  id: string;
  timestamp: number;
  isColdStart: boolean;
  duration: number;
  platform: string;
};

export class DeploymentTracker {
  private readonly invocations: InvocationRecord[] = [];
  private readonly startTime = Date.now();
  private invocationCount = 0;
  private isColdStart = true;

  recordInvocation(platform: string, duration: number): InvocationRecord {
    const record: InvocationRecord = {
      id: `inv-${++this.invocationCount}`,
      timestamp: Date.now(),
      isColdStart: this.isColdStart,
      duration,
      platform,
    };
    this.invocations.push(record);

    // After first invocation, no longer cold start
    this.isColdStart = false;

    return record;
  }

  getStats() {
    return {
      totalInvocations: this.invocationCount,
      uptime: Date.now() - this.startTime,
      coldStarts: this.invocations.filter((i) => i.isColdStart).length,
      warmStarts: this.invocations.filter((i) => !i.isColdStart).length,
      averageDuration:
        this.invocations.length > 0
          ? Math.round(this.invocations.reduce((sum, i) => sum + i.duration, 0) / this.invocations.length)
          : 0,
    };
  }

  getRecentInvocations(limit = 10): InvocationRecord[] {
    return this.invocations.slice(-limit);
  }

  checkColdStart(): boolean {
    return this.isColdStart;
  }

  simulateColdStart(): void {
    this.isColdStart = true;
  }
}

// Singleton instance for use across the app
export const deploymentTracker = new DeploymentTracker();
