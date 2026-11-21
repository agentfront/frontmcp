// file: plugins/plugin-codecall/src/services/runtime/execution-gate.ts

import type { ToolHandler } from '@enclave-vm/core/worker';

import type { CodeCallHostFunction } from './runtime.types';

/** The error a script continuation gets for a host call made after its execution ended. */
export class ExecutionEndedError extends Error {
  readonly code = 'EXECUTION_ENDED';

  constructor(target: string) {
    super(`Execution ended: ${target} is not reachable after the script has returned`);
    this.name = 'ExecutionEndedError';
  }
}

/** What the gate saw when the execution ended. */
export interface ExecutionGateReport {
  /**
   * Tool calls that had started and not settled when the execution ended. Their effects are not
   * rolled back: a tool that was running may still complete after the script's result is out.
   */
  pendingToolCalls: number;
}

/**
 * The host side of one execution, closed when the run returns. Whatever ended the run (a result,
 * an error, a timeout or an abort), a continuation of the script that is still scheduled reaches
 * neither a tool nor a host function from then on: every runtime gets the same guarantee, on top of
 * the runtime's own abort checks.
 */
export class ExecutionGate {
  private open = true;
  private inFlightToolCalls = 0;
  private report?: ExecutionGateReport;

  /** Whether the execution is still running. */
  get isOpen(): boolean {
    return this.open;
  }

  /** The tool handler, refusing a call once the execution has ended and counting calls in flight. */
  guardToolHandler(handler: ToolHandler): ToolHandler {
    return async (toolName: string, args: Record<string, unknown>) => {
      if (!this.open) throw new ExecutionEndedError(`tool "${String(toolName).slice(0, 128)}"`);
      this.inFlightToolCalls += 1;
      try {
        return await handler(toolName, args);
      } finally {
        this.inFlightToolCalls -= 1;
      }
    };
  }

  /** A host function, refusing a call once the execution has ended. */
  guardHostFunction(name: string, fn: CodeCallHostFunction): CodeCallHostFunction {
    return (...args: unknown[]) => {
      if (!this.open) throw new ExecutionEndedError(name);
      return fn(...args);
    };
  }

  /** End the execution. Idempotent: the first call's report is kept. */
  close(): ExecutionGateReport {
    if (!this.report) {
      this.open = false;
      this.report = { pendingToolCalls: this.inFlightToolCalls };
    }
    return this.report;
  }
}
