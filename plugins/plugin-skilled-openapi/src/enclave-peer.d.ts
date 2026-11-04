// Ambient declarations for the OPTIONAL `@enclave-vm` peers used by the codecall
// tool (`run_workflow`). They are lazy-imported at runtime: bundled (worker-safe
// source alias) on a V8-isolate target, resolved from node_modules on Node when
// installed, and a graceful "not available" error otherwise. Declaring them here
// lets the plugin typecheck/build without the (unpublished) packages installed,
// while keeping the import specifiers literal so a bundler can alias them.

declare module '@enclave-vm/ast' {
  export function transformAgentScript(
    code: string,
    config?: {
      wrapInMain?: boolean;
      transformCallTool?: boolean;
      transformLoops?: boolean;
      additionalIdentifiers?: string[];
    },
  ): string;
  export class JSAstValidator {
    constructor(rules?: unknown[]);
    validate(source: string): Promise<{ valid: boolean; ast?: unknown; parseError?: Error }>;
  }
  export function generateCode(ast: unknown): string;
}

declare module '@enclave-vm/core/worker' {
  export interface ExecutionContext {
    config: { maxToolCalls?: number; timeout?: number };
    stats: { duration: number; toolCallCount: number; iterationCount: number; startTime: number };
    abortController: AbortController;
    aborted: boolean;
    toolHandler?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }
  export interface ExecutionResult<T = unknown> {
    success: boolean;
    value?: T;
    error?: { message: string; name?: string; code?: string };
    stats: { duration: number; toolCallCount: number; iterationCount: number; startTime: number; endTime?: number };
  }
  export class InterpreterAdapter {
    constructor(options?: { maxSteps?: number; maxCallDepth?: number });
    execute<T = unknown>(code: string, context: ExecutionContext): Promise<ExecutionResult<T>>;
    dispose(): void;
  }
}

declare module '@enclave-vm/browser' {
  export interface ExecutionResult<T = unknown> {
    success: boolean;
    value?: T;
    error?: { message: string; name: string; code?: string };
    stats: { duration: number; toolCallCount: number; iterationCount: number; startTime: number; endTime: number };
  }
  export class BrowserEnclave {
    constructor(options?: { timeout?: number; maxToolCalls?: number });
    run<T = unknown>(
      code: string,
      toolHandler?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>,
    ): Promise<ExecutionResult<T>>;
    dispose(): void;
  }
}
