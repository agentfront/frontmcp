/**
 * Simple execution tracker to count actual tool invocations.
 * Used to verify cache hits vs actual executions.
 */
class ExecutionTracker {
  private executions: Map<string, number> = new Map();

  increment(toolName: string): number {
    const count = (this.executions.get(toolName) || 0) + 1;
    this.executions.set(toolName, count);
    return count;
  }

  getCount(toolName: string): number {
    return this.executions.get(toolName) || 0;
  }

  getAll(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of this.executions) {
      result[key] = value;
    }
    return result;
  }

  reset(): void {
    this.executions.clear();
  }
}

// Singleton instance
export const executionTracker = new ExecutionTracker();
