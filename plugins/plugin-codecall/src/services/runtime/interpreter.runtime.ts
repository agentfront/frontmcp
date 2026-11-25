// file: plugins/plugin-codecall/src/services/runtime/interpreter.runtime.ts
//
// The `interpreter` runtime: Enclave's validated AgentScript runner from the worker-safe
// `@enclave-vm/core/worker` entry point, for Node and Cloudflare Workers alike.
//
// CodeCall hands the runner raw AgentScript. The runner owns the whole Enclave pipeline: input-size
// and pre-scan limits on the raw text, the AgentScript transform, AST validation with the
// AgentScript preset, runtime guards, then interpretation. CodeCall never calls
// `InterpreterAdapter.execute()` itself: that adapter executes whatever text it is given, skips
// validation, and supports no host functions.
//
// The runner must also enforce what CodeCall configures on the Node VM: synchronous host functions
// (`getTool`, `mcpLog`, `mcpNotify`) behind an abort gate and a finite call budget, tool namespaces,
// the sidecar, the console limits and the rapid-enumeration policy. It lists what it enforces in
// `capabilities`; a configuration that needs anything missing from that list is refused, never run
// without it.
//
// The worker entry is loaded with a literal specifier, so bundlers include it: it imports no Node
// built-in. Only types come from the full barrel, and they are erased.

import type { ConsoleHandler, ReferenceSidecarOptions } from '@enclave-vm/core';
import type {
  ExecutionResult,
  ReferenceEntry,
  ReviewContext,
  ReviewOptions,
  ToolHandler,
} from '@enclave-vm/core/worker';

import { CodeCallRuntimeError } from './runtime.errors';
import {
  CODECALL_ENCLAVE_SECURITY_LEVEL,
  runOptionsOf,
  type CodeCallHostFunction,
  type CodeCallReplayedCall,
  type CodeCallScriptRunner,
  type CodeCallScriptRunSpec,
  type CodeCallScriptRuntime,
} from './runtime.types';

/** The export of `@enclave-vm/core/worker` this runtime needs. */
export const AGENT_SCRIPT_RUNNER_EXPORT = 'AgentScriptRunner';

/** A control or feature the runner enforces. */
export type AgentScriptRunnerCapability =
  /** Pre-scan, AgentScript transform and AST validation run before anything is interpreted. */
  | 'validated-agentscript'
  /** Synchronous host functions behind the abort gate and `maxHostFunctionCalls`, with plain-data copies both ways. */
  | 'host-functions'
  /** `toolNamespaces` methods are `callTool()` calls inside the sandbox. */
  | 'tool-namespaces'
  /** Pass-by-reference sidecar extraction and resolution at the tool boundary. */
  | 'sidecar'
  /** Console calls and bytes bounded per run. */
  | 'console'
  /** The per-tool rapid-enumeration threshold and overrides. */
  | 'rapid-enumeration'
  /** Review hooks before the run and each tool call. */
  | 'review'
  /** Sidecar entries an earlier run kept, which the run starts with. */
  | 'kept-references'
  /** `toolResultOrder: 'call'` and the host's `clock` and `random`, which a replayed run needs. */
  | 'replay'
  /** The `replayedCalls` run option: Enclave's detectors judge replayed calls by when they first reached the host. */
  | 'replayed-calls';

/** The options CodeCall gives the runner. */
export interface AgentScriptRunnerOptions {
  securityLevel: typeof CODECALL_ENCLAVE_SECURITY_LEVEL;
  timeout: number;
  maxToolCalls: number;
  maxIterations: number;
  /** Interpreter instruction budget. */
  maxSteps?: number;
  maxCallDepth?: number;
  maxPendingCalls?: number;
  /** Allocation and result-serialization budget in bytes. */
  memoryLimit?: number;
  maxSanitizeDepth: number;
  maxSanitizeProperties: number;
  sanitizeStackTraces: true;
  toolHandler: ToolHandler;
  hostFunctions: Readonly<Record<string, CodeCallHostFunction>>;
  maxHostFunctionCalls: number;
  consoleHandler?: ConsoleHandler;
  toolNamespaces?: Record<string, Record<string, string>>;
  sidecar?: ReferenceSidecarOptions;
  rapidEnumeration: { threshold?: number; overrides?: Record<string, number> };
  review?: ReviewOptions;
  toolResultOrder?: 'call';
  clock?: () => number;
  random?: () => number;
}

/** One runner per execution. */
export interface AgentScriptRunnerInstance {
  run<T = unknown>(
    code: string,
    toolHandler?: ToolHandler,
    options?: {
      reviewContext?: ReviewContext;
      preloadReferences?: readonly ReferenceEntry[];
      replayedCalls?: readonly CodeCallReplayedCall[];
    },
  ): Promise<ExecutionResult<T>>;
  dispose(): void;
}

/** The runner class `@enclave-vm/core/worker` must export as {@link AGENT_SCRIPT_RUNNER_EXPORT}. */
export interface AgentScriptRunnerClass {
  new (options: AgentScriptRunnerOptions): AgentScriptRunnerInstance;
  readonly capabilities: readonly string[];
}

/** How the runtime loads the worker entry; replaced in tests. */
export type WorkerEntryLoader = () => Promise<Record<string, unknown>>;

export const loadWorkerEntry: WorkerEntryLoader = async () =>
  (await import('@enclave-vm/core/worker')) as unknown as Record<string, unknown>;

/** Host-function calls a script may make: as many as the Node VM allows by default. */
export function maxHostFunctionCallsOf(maxToolCalls: number): number {
  return maxToolCalls * 10;
}

/** What a spec needs the runner to enforce. */
export function requiredCapabilities(spec: CodeCallScriptRunSpec): AgentScriptRunnerCapability[] {
  const required: AgentScriptRunnerCapability[] = ['validated-agentscript', 'host-functions', 'rapid-enumeration'];
  if (spec.toolNamespaces && Object.keys(spec.toolNamespaces).length > 0) required.push('tool-namespaces');
  if (spec.sidecar) required.push('sidecar');
  if (spec.consoleHandler) required.push('console');
  if (spec.review) required.push('review');
  if (spec.preloadReferences) required.push('kept-references');
  return required;
}

/** The runner options for a run spec. */
export function toRunnerOptions(spec: CodeCallScriptRunSpec): AgentScriptRunnerOptions {
  return {
    securityLevel: CODECALL_ENCLAVE_SECURITY_LEVEL,
    timeout: spec.timeoutMs,
    maxToolCalls: spec.maxToolCalls,
    maxIterations: spec.maxIterations,
    ...(spec.maxInterpreterSteps !== undefined && { maxSteps: spec.maxInterpreterSteps }),
    ...(spec.maxCallDepth !== undefined && { maxCallDepth: spec.maxCallDepth }),
    ...(spec.maxPendingCalls !== undefined && { maxPendingCalls: spec.maxPendingCalls }),
    ...(spec.memoryLimitBytes !== undefined && { memoryLimit: spec.memoryLimitBytes }),
    maxSanitizeDepth: spec.maxSanitizeDepth,
    maxSanitizeProperties: spec.maxSanitizeProperties,
    sanitizeStackTraces: true,
    toolHandler: spec.toolHandler,
    hostFunctions: spec.hostFunctions,
    maxHostFunctionCalls: maxHostFunctionCallsOf(spec.maxToolCalls),
    consoleHandler: spec.consoleHandler,
    toolNamespaces: spec.toolNamespaces,
    sidecar: spec.sidecar,
    rapidEnumeration: { ...spec.rapidEnumeration },
    ...(spec.review && { review: spec.review }),
    ...(spec.clock && { toolResultOrder: spec.toolResultOrder, clock: spec.clock, random: spec.random }),
  };
}

function isRunnerClass(value: unknown): value is AgentScriptRunnerClass {
  return typeof value === 'function' && Array.isArray((value as { capabilities?: unknown }).capabilities);
}

/**
 * A runner for these options. As on the Node VM, a runner that refuses the whole `toolNamespaces`
 * configuration over a name it can't bind runs the script without namespaces (`callTool()` always
 * works); any other construction error propagates.
 */
function createRunner(Runner: AgentScriptRunnerClass, options: AgentScriptRunnerOptions): AgentScriptRunnerInstance {
  try {
    return new Runner(options);
  } catch (error: unknown) {
    if (
      !options.toolNamespaces ||
      !(error instanceof TypeError) ||
      !error.message.startsWith('Invalid toolNamespaces')
    ) {
      throw error;
    }
    return new Runner({ ...options, toolNamespaces: undefined });
  }
}

/** The `interpreter` runtime. */
export function createInterpreterRuntime(loader: WorkerEntryLoader = loadWorkerEntry): CodeCallScriptRuntime {
  return {
    name: 'interpreter',
    async replaysCallTimes(): Promise<boolean> {
      const Runner = await loader().then(
        (entry) => entry[AGENT_SCRIPT_RUNNER_EXPORT],
        () => undefined,
      );
      return isRunnerClass(Runner) && ['replay', 'replayed-calls'].every((name) => Runner.capabilities.includes(name));
    },
    async createRunner(spec: CodeCallScriptRunSpec): Promise<CodeCallScriptRunner> {
      let entry: Record<string, unknown>;
      try {
        entry = await loader();
      } catch {
        throw new CodeCallRuntimeError(
          'RUNTIME_UNAVAILABLE',
          'interpreter',
          "CodeCall vm.runtime 'interpreter' could not load @enclave-vm/core/worker.",
        );
      }
      const Runner = entry[AGENT_SCRIPT_RUNNER_EXPORT];
      if (!isRunnerClass(Runner)) {
        throw new CodeCallRuntimeError(
          'RUNTIME_UNAVAILABLE',
          'interpreter',
          `CodeCall vm.runtime 'interpreter' needs Enclave's validated AgentScript runner ` +
            `(${AGENT_SCRIPT_RUNNER_EXPORT} from @enclave-vm/core/worker), which the installed @enclave-vm/core ` +
            'does not export. CodeCall does not run scripts through the bare InterpreterAdapter, which skips validation.',
        );
      }
      const missing = requiredCapabilities(spec).filter((capability) => !Runner.capabilities.includes(capability));
      if (missing.length > 0) {
        throw new CodeCallRuntimeError(
          'RUNTIME_FEATURE_UNSUPPORTED',
          'interpreter',
          `CodeCall vm.runtime 'interpreter' cannot enforce ${missing.join(', ')} with the installed ` +
            '@enclave-vm/core; the script was not run. Change the configuration or the runtime.',
        );
      }
      const replays = spec.clock !== undefined && Runner.capabilities.includes('replay');
      const replaysCallTimes = replays && Runner.capabilities.includes('replayed-calls');
      const runOptions = {
        ...runOptionsOf(spec),
        ...(replaysCallTimes && spec.replayedCalls && { replayedCalls: spec.replayedCalls }),
      };
      // A runner without 'replay' runs the script as before, and the run cannot be replayed
      const runner = createRunner(Runner, toRunnerOptions(replays ? spec : { ...spec, clock: undefined }));
      return {
        run: (code) => runner.run<unknown>(code, undefined, runOptions),
        dispose: () => runner.dispose(),
        replays,
        replaysCallTimes,
      };
    },
  };
}
