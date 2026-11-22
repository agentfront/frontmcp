// file: plugins/plugin-codecall/src/services/runtime/runtime.errors.ts

import type { CodeCallRuntimeName } from './runtime.types';

/** Why CodeCall refused to run a script in the configured runtime. */
export type CodeCallRuntimeErrorCode =
  /** The runtime cannot run here (the Node VM in a Worker, or an Enclave without the runner). */
  | 'RUNTIME_UNAVAILABLE'
  /** The runtime runs here but cannot enforce a control or feature this configuration needs. */
  | 'RUNTIME_FEATURE_UNSUPPORTED'
  /** The runtime selection or one of its budgets is invalid. */
  | 'RUNTIME_CONFIG_INVALID';

/**
 * A refusal to run a script, raised before any of it runs. It is a server configuration or
 * deployment problem, never a script error: CodeCall reports it and does not fall back to
 * another runtime or drop the control that needs it.
 */
export class CodeCallRuntimeError extends Error {
  readonly code: CodeCallRuntimeErrorCode;
  readonly runtime: CodeCallRuntimeName | string;

  constructor(code: CodeCallRuntimeErrorCode, runtime: CodeCallRuntimeName | string, message: string) {
    super(message);
    this.name = 'CodeCallRuntimeError';
    this.code = code;
    this.runtime = runtime;
  }
}
