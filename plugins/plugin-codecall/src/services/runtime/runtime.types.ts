// file: plugins/plugin-codecall/src/services/runtime/runtime.types.ts
//
// The seam between CodeCall's execution service and the Enclave runtime that runs a script.
//
// Every import from `@enclave-vm/core` here is type-only and erased by the build: this module
// must never make a Worker bundle load the Node-only `@enclave-vm/core` barrel.

import type { ConsoleHandler, ReferenceSidecarOptions } from '@enclave-vm/core';
import type {
  ExecutionResult,
  ReferenceEntry,
  ReviewContext,
  ReviewOptions,
  ToolHandler,
} from '@enclave-vm/core/worker';

/**
 * The Enclave runtime a script runs in (`vm.runtime`).
 *
 * - `interpreter`: Enclave's validated AgentScript runner from the worker-safe
 *   `@enclave-vm/core/worker` entry point. The portable target for Node and Cloudflare Workers.
 * - `node-vm`: Enclave's `node:vm` double VM from the full `@enclave-vm/core` barrel. Node only.
 */
export type CodeCallRuntimeName = 'interpreter' | 'node-vm';

/**
 * Enclave's security level for CodeCall, on every runtime: fixed, so a change of Enclave's default
 * cannot move CodeCall. It is not configurable.
 */
export const CODECALL_ENCLAVE_SECURITY_LEVEL = 'STANDARD';

/** Every runtime name CodeCall accepts. */
export const CODECALL_RUNTIME_NAMES: readonly CodeCallRuntimeName[] = ['interpreter', 'node-vm'];

/**
 * The runtime used when `vm.runtime` is not set. `node-vm` until the interpreter path has passed
 * feature parity and security tests on Node and Cloudflare Workers.
 */
export const DEFAULT_CODECALL_RUNTIME: CodeCallRuntimeName = 'node-vm';

/** The runtime selection and the budgets that come with it, as the service reads them. */
export interface CodeCallRuntimeSettings {
  runtime: CodeCallRuntimeName;
  /** Tool calls a script may make (`vm.maxToolCalls`, else the legacy `vm.maxSteps`, else 100). */
  maxToolCalls: number;
  /** Interpreter instruction budget (`vm.maxInterpreterSteps`); the runner's default when unset. */
  maxInterpreterSteps?: number;
  /** Interpreter call-depth cap (`vm.maxCallDepth`); the runner's default when unset. */
  maxCallDepth?: number;
  /** Interpreter cap on unfinished calls (`vm.maxPendingCalls`); the runner's default when unset. */
  maxPendingCalls?: number;
  /** Per-run allocation/serialization budget (`vm.memoryLimitBytes`); the runtime's default when unset. */
  memoryLimitBytes?: number;
}

/**
 * A function the script may call that runs on the host (`getTool`, `mcpLog`, `mcpNotify`).
 * CodeCall only provides synchronous ones; their results are plain data.
 */
export type CodeCallHostFunction = (...args: unknown[]) => unknown;

/** Rapid-enumeration policy: calls to one tool a script may make within about 2 seconds. */
export interface CodeCallRapidEnumerationPolicy {
  threshold?: number;
  overrides?: Record<string, number>;
}

/**
 * Everything one execution needs, independent of the runtime that runs it. Each runtime maps it
 * onto its own options; a runtime that cannot enforce a part of it must refuse the execution.
 */
export interface CodeCallScriptRunSpec {
  /** Wall-clock budget in milliseconds. */
  timeoutMs: number;
  /** Iterations each loop of a script may make. */
  maxIterations: number;
  /** Tool calls a script may make. */
  maxToolCalls: number;
  /** Interpreter instruction budget (interpreter only). */
  maxInterpreterSteps?: number;
  /** Interpreter call-depth cap (interpreter only). */
  maxCallDepth?: number;
  /** Interpreter cap on unfinished calls (interpreter only). */
  maxPendingCalls?: number;
  /** Per-run allocation/serialization budget in bytes. */
  memoryLimitBytes?: number;
  /** Output sanitization limits for tool results and the script's return value. */
  maxSanitizeDepth: number;
  maxSanitizeProperties: number;
  /** The bridge to CodeCall's `callTool` closure. It throws on every tool failure. */
  toolHandler: ToolHandler;
  /** Host functions the script may call by name. Always contains `getTool`. */
  hostFunctions: Readonly<Record<string, CodeCallHostFunction>>;
  /** Where the script's console goes; set only with an explicit `vm.allowConsole: true`. */
  consoleHandler?: ConsoleHandler;
  /** Dotted tool names as namespaces (`{ acme: { getUser: 'acme.getUser' } }`), already filtered. */
  toolNamespaces?: Record<string, Record<string, string>>;
  /** Pass-by-reference sidecar, when enabled. */
  sidecar?: ReferenceSidecarOptions;
  /** Sidecar entries the run starts with: the large values it recalls (with the sidecar only). */
  preloadReferences?: readonly ReferenceEntry[];
  rapidEnumeration: CodeCallRapidEnumerationPolicy;
  /** Review hooks before the run and each tool call, when the server's `review` is on. */
  review?: ReviewOptions;
  /** What the review hooks of this run receive as `context`: the caller. */
  reviewContext?: ReviewContext;
  /** `'call'` delivers tool results in call order, for a run that may be replayed. */
  toolResultOrder?: 'call';
  /** What the script's `Date` reads, for a run that may be replayed. */
  clock?: () => number;
  /** What the script's `Math.random()` returns, for a run that may be replayed. */
  random?: () => number;
}

/** The outcome of one run, in Enclave's `ExecutionResult` shape. */
export type CodeCallRunResult = ExecutionResult<unknown>;

/** A runner for one execution, created by a runtime and disposed after the run. */
export interface CodeCallScriptRunner {
  /** Run raw AgentScript. The runtime validates and transforms it before anything executes. */
  run(code: string): Promise<CodeCallRunResult>;
  dispose(): void;
  /** Whether the runner applies the spec's `toolResultOrder`, `clock` and `random`, which a replayed run needs. */
  readonly replays?: boolean;
}

/** A runtime CodeCall can execute scripts in. */
export interface CodeCallScriptRuntime {
  readonly name: CodeCallRuntimeName;
  /**
   * A runner for this spec. Rejects with a {@link CodeCallRuntimeError} when the runtime is
   * unavailable here or cannot enforce every part of the spec.
   */
  createRunner(spec: CodeCallScriptRunSpec): Promise<CodeCallScriptRunner>;
}

/** The options of one run: the review hooks' context, and the sidecar entries the run starts with. */
export function runOptionsOf(spec: CodeCallScriptRunSpec): {
  reviewContext?: ReviewContext;
  preloadReferences?: readonly ReferenceEntry[];
} {
  return {
    reviewContext: spec.reviewContext,
    ...(spec.preloadReferences && { preloadReferences: spec.preloadReferences }),
  };
}
