// file: libs/plugins/src/codecall/providers/code-call.config.ts

import { BaseConfig, Provider, ProviderScope } from '@frontmcp/sdk';
import { getRuntimeContext } from '@frontmcp/utils';

import { type ResolvedCodeCallVmOptions } from '../codecall.symbol';
import {
  codeCallPluginOptionsSchema,
  DEFAULT_VM_RUNTIME,
  INTERPRETER_BUDGET_LIMITS,
  type CodeCallPluginOptions,
  type CodeCallSidecarOptions,
  type CodeCallVmOptions,
  type CodeCallVmPreset,
  type CodeCallVmRuntime,
} from '../codecall.types';

/**
 * CodeCall configuration provider with convict-like API
 * Extends BaseConfig to provide type-safe dotted path access
 *
 * @example
 * // Get values with dotted path notation
 * config.get('vm.preset') // returns 'secure'
 * config.get('embedding.strategy') // returns 'tfidf'
 * config.get('directCalls.enabled') // returns true
 *
 * // Get with default value
 * config.get('vm.timeoutMs', 5000) // returns value or 5000
 *
 * // Get entire sections
 * config.getSection('vm') // returns entire vm config
 * config.getAll() // returns complete config
 *
 * // Require values (throws if undefined)
 * config.getOrThrow('mode') // throws if undefined
 * config.getRequired('topK') // same as getOrThrow
 */
@Provider({
  name: 'codecall:config',
  description: 'CodeCall plugin configuration with validated defaults',
  scope: ProviderScope.GLOBAL,
})
export default class CodeCallConfig extends BaseConfig<
  CodeCallPluginOptions & { resolvedVm: ResolvedCodeCallVmOptions }
> {
  constructor(options: Partial<CodeCallPluginOptions> = {}) {
    // Parse and validate options with Zod schema to apply all defaults
    const parsedConfig = codeCallPluginOptionsSchema.parse(options);

    // A runtime the server names must be one this deployment can run.
    if (parsedConfig.vm.runtime !== undefined) {
      assertVmRuntimeAvailable(parsedConfig.vm.runtime, getRuntimeContext().target);
    }

    // Resolve VM options with preset defaults
    const resolvedVm = resolveVmOptions(parsedConfig.vm);

    super({ ...parsedConfig, resolvedVm });
  }
}

/**
 * Enclave's security level for every CodeCall script, whatever the runtime and preset; not configurable. Presets
 * set CodeCall's own syntax policy and limits on top of it, and nothing in the options turns Enclave's validation or
 * transformation off.
 */
export const CODECALL_ENCLAVE_SECURITY_LEVEL = 'STANDARD' as const;

/**
 * The runtimes this version of CodeCall runs scripts in. A server that names another one in `vm.runtime` is refused
 * when the plugin starts, rather than having its scripts run somewhere it did not choose.
 */
export const AVAILABLE_VM_RUNTIMES: readonly CodeCallVmRuntime[] = ['node-vm', 'interpreter'];

/**
 * Why scripts can't run in `runtime` in a deployment built for `buildTarget` (`getRuntimeContext().target`, which
 * `frontmcp build --target` records), or `undefined` when they can.
 */
export function vmRuntimeUnavailableReason(runtime: CodeCallVmRuntime, buildTarget: string): string | undefined {
  if (!AVAILABLE_VM_RUNTIMES.includes(runtime)) {
    return `CodeCall vm.runtime '${runtime}' is not available in this version of @frontmcp/plugin-codecall (available: ${AVAILABLE_VM_RUNTIMES.map((name) => `'${name}'`).join(', ')})`;
  }
  if (runtime === 'node-vm' && buildTarget === 'cloudflare') {
    const instead = AVAILABLE_VM_RUNTIMES.includes('interpreter')
      ? "use vm.runtime 'interpreter'"
      : 'this version of @frontmcp/plugin-codecall cannot run scripts in a Worker';
    return `CodeCall vm.runtime 'node-vm' needs Node's vm module, which Cloudflare Workers do not provide (nodejs_compat only stubs it): ${instead}`;
  }
  return undefined;
}

/** Throws when scripts can't run in `runtime` in a deployment built for `buildTarget`. */
export function assertVmRuntimeAvailable(runtime: CodeCallVmRuntime, buildTarget: string): void {
  const reason = vmRuntimeUnavailableReason(runtime, buildTarget);
  if (reason !== undefined) throw new CodeCallVmRuntimeUnavailableError(reason);
}

/**
 * Thrown when the plugin starts with a `vm.runtime` the deployment can't run scripts in. A startup error, like the
 * options schema's own refusals: no MCP client ever receives it.
 */
export class CodeCallVmRuntimeUnavailableError extends Error {
  readonly code = 'CODECALL_VM_RUNTIME_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'CodeCallVmRuntimeUnavailableError';
  }
}

/** Iterations the sandbox allows each loop of a script; not configurable. */
export const MAX_ITERATIONS_PER_LOOP = 10000;

/** Tool calls a script may make: `vm.maxToolCalls`, else its deprecated alias `vm.maxSteps`, else the preset's. */
export function maxToolCallsOf(vmOptions: ResolvedCodeCallVmOptions): number {
  return vmOptions.maxToolCalls;
}

/** The sandbox's own limit on calls to one tool within about 2 seconds. */
const SANDBOX_RAPID_ENUMERATION_THRESHOLD = 30;

/** Calls to one tool a script may make within about 2 seconds: `vm.rapidEnumerationThreshold`, else 30. */
export function rapidEnumerationThresholdOf(vmOptions: ResolvedCodeCallVmOptions): number {
  return vmOptions.rapidEnumerationThreshold ?? SANDBOX_RAPID_ENUMERATION_THRESHOLD;
}

/** The sidecar's extraction threshold at Enclave's STANDARD level, the level of every CodeCall script. */
const SANDBOX_EXTRACTION_THRESHOLD = 1024 * 1024;

/** The UTF-8 bytes from which the sidecar keeps a string out of the sandbox: `sidecar.extractionThreshold`, else 1 MiB. */
export function extractionThresholdOf(sidecar: CodeCallSidecarOptions): number {
  return sidecar.extractionThreshold ?? SANDBOX_EXTRACTION_THRESHOLD;
}

// ---- VM Options Resolution ----

/** What a preset sets: the limits and syntax policy, never the runtime or the interpreter's budgets. */
type PresetDefaults = Omit<
  ResolvedCodeCallVmOptions,
  'runtime' | 'maxInterpreterSteps' | 'memoryLimitBytes' | 'maxCallDepth' | 'maxPendingCalls'
>;

/**
 * The `vm` options with every default applied. Expects options the schema has parsed, which refuses the
 * contradictions (a `maxSteps` unlike `maxToolCalls`, an interpreter budget with `'node-vm'`).
 */
export function resolveVmOptions(vmOptions?: CodeCallVmOptions): ResolvedCodeCallVmOptions {
  const preset: CodeCallVmPreset = vmOptions?.preset ?? 'secure';

  const base = presetDefaults(preset);

  return {
    preset,
    runtime: vmOptions?.runtime ?? DEFAULT_VM_RUNTIME,
    timeoutMs: vmOptions?.timeoutMs ?? base.timeoutMs,
    allowLoops: vmOptions?.allowLoops ?? base.allowLoops,
    // `maxSteps` is the deprecated name of `maxToolCalls`: a tool-call budget, never interpreter steps.
    maxToolCalls: vmOptions?.maxToolCalls ?? vmOptions?.maxSteps ?? base.maxToolCalls,
    maxInterpreterSteps: vmOptions?.maxInterpreterSteps ?? INTERPRETER_BUDGET_LIMITS.maxInterpreterSteps.default,
    memoryLimitBytes: vmOptions?.memoryLimitBytes ?? INTERPRETER_BUDGET_LIMITS.memoryLimitBytes.default,
    maxCallDepth: vmOptions?.maxCallDepth ?? INTERPRETER_BUDGET_LIMITS.maxCallDepth.default,
    maxPendingCalls: vmOptions?.maxPendingCalls ?? INTERPRETER_BUDGET_LIMITS.maxPendingCalls.default,
    disabledBuiltins: vmOptions?.disabledBuiltins ?? base.disabledBuiltins,
    disabledGlobals: vmOptions?.disabledGlobals ?? base.disabledGlobals,
    // Scripts get console only from an explicit `vm.allowConsole: true`, never from a preset.
    allowConsole: vmOptions?.allowConsole === true,
    maxSanitizeDepth: vmOptions?.maxSanitizeDepth ?? base.maxSanitizeDepth,
    maxSanitizeProperties: vmOptions?.maxSanitizeProperties ?? base.maxSanitizeProperties,
    ...(vmOptions?.rapidEnumerationThreshold !== undefined && {
      rapidEnumerationThreshold: vmOptions.rapidEnumerationThreshold,
    }),
    ...(vmOptions?.rapidEnumerationOverrides !== undefined && {
      rapidEnumerationOverrides: vmOptions.rapidEnumerationOverrides,
    }),
  };
}

function presetDefaults(preset: CodeCallVmPreset): PresetDefaults {
  switch (preset) {
    case 'locked_down':
      return {
        preset,
        timeoutMs: 2000,
        allowLoops: false,
        allowConsole: false,
        maxToolCalls: 2000,
        disabledBuiltins: ['eval', 'Function', 'AsyncFunction'],
        disabledGlobals: [
          'require',
          'process',
          'fetch',
          'setTimeout',
          'setInterval',
          'setImmediate',
          'global',
          'globalThis',
        ],
        maxSanitizeDepth: 10,
        maxSanitizeProperties: 1000,
      };

    case 'balanced':
      return {
        preset,
        timeoutMs: 5000,
        allowLoops: true,
        allowConsole: false,
        maxToolCalls: 10000,
        disabledBuiltins: ['eval', 'Function', 'AsyncFunction'],
        disabledGlobals: ['require', 'process', 'fetch'],
        maxSanitizeDepth: 50,
        maxSanitizeProperties: 5000,
      };

    case 'experimental':
      return {
        preset,
        timeoutMs: 10000,
        allowLoops: true,
        allowConsole: false,
        maxToolCalls: 20000,
        disabledBuiltins: ['eval', 'Function', 'AsyncFunction'],
        disabledGlobals: ['require', 'process'],
        maxSanitizeDepth: 100,
        maxSanitizeProperties: 20000,
      };

    case 'secure':
    default:
      return {
        preset: 'secure',
        timeoutMs: 3500,
        allowLoops: false,
        allowConsole: false,
        maxToolCalls: 5000,
        disabledBuiltins: ['eval', 'Function', 'AsyncFunction'],
        disabledGlobals: [
          'require',
          'process',
          'fetch',
          'setTimeout',
          'setInterval',
          'setImmediate',
          'global',
          'globalThis',
        ],
        maxSanitizeDepth: 50,
        maxSanitizeProperties: 2000,
      };
  }
}
