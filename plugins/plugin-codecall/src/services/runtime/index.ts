// file: plugins/plugin-codecall/src/services/runtime/index.ts

import { createInterpreterRuntime } from './interpreter.runtime';
import { createNodeVmRuntime } from './node-vm.runtime';
import type { CodeCallRuntimeName, CodeCallScriptRuntime } from './runtime.types';

export { CodeCallRuntimeError, type CodeCallRuntimeErrorCode } from './runtime.errors';
export { runtimeSettingsOf } from './runtime-settings';
export * from './runtime.types';

/** The runtimes CodeCall executes scripts in, by name. */
export type CodeCallScriptRuntimes = Readonly<Record<CodeCallRuntimeName, CodeCallScriptRuntime>>;

/** The runtimes as shipped: each loads its Enclave entry point when first used, or when `node-vm` is preloaded. */
export function createDefaultRuntimes(): CodeCallScriptRuntimes {
  return { interpreter: createInterpreterRuntime(), 'node-vm': createNodeVmRuntime() };
}
