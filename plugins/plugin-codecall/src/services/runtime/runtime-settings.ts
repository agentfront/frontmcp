// file: plugins/plugin-codecall/src/services/runtime/runtime-settings.ts

import type { ResolvedCodeCallVmOptions } from '../../codecall.symbol';
import { maxToolCallsOf } from '../../providers/code-call.config';
import { CodeCallRuntimeError } from './runtime.errors';
import {
  CODECALL_RUNTIME_NAMES,
  DEFAULT_CODECALL_RUNTIME,
  type CodeCallRuntimeName,
  type CodeCallRuntimeSettings,
} from './runtime.types';

/**
 * The runtime fields of the resolved `vm` options (`vm.runtime` and its budgets), read defensively:
 * the configuration schema owns their validation, and this reader refuses anything it would not.
 */
interface RuntimeVmFields {
  runtime?: unknown;
  maxToolCalls?: unknown;
  maxInterpreterSteps?: unknown;
  maxCallDepth?: unknown;
  maxPendingCalls?: unknown;
  memoryLimitBytes?: unknown;
}

function isRuntimeName(value: unknown): value is CodeCallRuntimeName {
  return typeof value === 'string' && (CODECALL_RUNTIME_NAMES as readonly string[]).includes(value);
}

/**
 * A finite positive integer budget, or `undefined` when the option is not set. Zero, a negative
 * number, `Infinity` or a fraction is refused: none of them means "unlimited".
 */
function budgetOf(value: unknown, option: string, runtime: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new CodeCallRuntimeError(
      'RUNTIME_CONFIG_INVALID',
      runtime,
      `CodeCall option ${option} must be a finite positive integer; got ${String(value)}.`,
    );
  }
  return value;
}

/**
 * The runtime and budgets an execution uses.
 *
 * `vm.maxSteps` keeps its meaning: it is the tool-call budget (an alias of `vm.maxToolCalls`), never
 * an interpreter instruction budget, which is `vm.maxInterpreterSteps`.
 *
 * @throws CodeCallRuntimeError (`RUNTIME_CONFIG_INVALID`) for an unknown runtime or an invalid budget
 */
export function runtimeSettingsOf(vmOptions: ResolvedCodeCallVmOptions): CodeCallRuntimeSettings {
  const fields = vmOptions as ResolvedCodeCallVmOptions & RuntimeVmFields;
  const requested = fields.runtime ?? DEFAULT_CODECALL_RUNTIME;
  if (!isRuntimeName(requested)) {
    throw new CodeCallRuntimeError(
      'RUNTIME_CONFIG_INVALID',
      String(requested),
      `CodeCall option vm.runtime must be one of ${CODECALL_RUNTIME_NAMES.map((name) => `'${name}'`).join(', ')}; ` +
        `got ${JSON.stringify(requested)}.`,
    );
  }
  const runtime = requested;

  const maxToolCalls = budgetOf(fields.maxToolCalls, 'vm.maxToolCalls', runtime) ?? maxToolCallsOf(vmOptions);
  const settings: CodeCallRuntimeSettings = { runtime, maxToolCalls };

  const maxInterpreterSteps = budgetOf(fields.maxInterpreterSteps, 'vm.maxInterpreterSteps', runtime);
  const maxCallDepth = budgetOf(fields.maxCallDepth, 'vm.maxCallDepth', runtime);
  const maxPendingCalls = budgetOf(fields.maxPendingCalls, 'vm.maxPendingCalls', runtime);
  const memoryLimitBytes = budgetOf(fields.memoryLimitBytes, 'vm.memoryLimitBytes', runtime);
  if (maxInterpreterSteps !== undefined) settings.maxInterpreterSteps = maxInterpreterSteps;
  if (maxCallDepth !== undefined) settings.maxCallDepth = maxCallDepth;
  if (maxPendingCalls !== undefined) settings.maxPendingCalls = maxPendingCalls;
  if (memoryLimitBytes !== undefined) settings.memoryLimitBytes = memoryLimitBytes;
  return settings;
}
