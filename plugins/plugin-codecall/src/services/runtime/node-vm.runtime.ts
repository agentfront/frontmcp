// file: plugins/plugin-codecall/src/services/runtime/node-vm.runtime.ts
//
// The `node-vm` runtime: Enclave's `node:vm` double VM, from the full `@enclave-vm/core` barrel.
//
// NODE ONLY. The barrel depends on `node:vm` and `node:worker_threads`, which Cloudflare Workers
// provide only as non-functional `nodejs_compat` stubs. It is therefore loaded lazily, through a
// specifier bundlers cannot follow, so no Worker bundle ever contains it; in a Worker this runtime
// refuses to run instead of reaching a stub.
//
// CONTAINMENT: this runtime runs scripts inside the host process. A script that exhausts the
// engine's native stack or the process heap can make Node itself write diagnostics to the
// process's stderr, or end the process, whatever the CodeCall preset. A deployment that keeps
// `node-vm` must contain that at the process boundary: a dedicated, memory-constrained child
// process or container per CodeCall host, with its stderr captured and its exit tolerated. Worker
// threads do not contain either outcome. The `interpreter` runtime does not depend on that boundary
// for this class of failure.

import type { CreateEnclaveOptions, Enclave } from '@enclave-vm/core';

import { CodeCallRuntimeError } from './runtime.errors';
import {
  CODECALL_ENCLAVE_SECURITY_LEVEL,
  type CodeCallScriptRunner,
  type CodeCallScriptRunSpec,
  type CodeCallScriptRuntime,
} from './runtime.types';

/** The full Enclave barrel: never a static import (see the file header). */
const NODE_VM_PACKAGE = '@enclave-vm/core';

/** The part of the barrel this runtime uses. */
export interface NodeVmModule {
  Enclave: new (options: CreateEnclaveOptions) => Pick<Enclave, 'run' | 'dispose'>;
  /** Exported by an Enclave whose `review` option runs its hooks; an older one would ignore the option. */
  REVIEW_ERROR_CODES?: unknown;
}

/**
 * Load a module whose specifier is passed in at run time. Bundlers (esbuild, wrangler, rspack) only
 * follow a literal specifier, so this keeps the module out of every bundle built from CodeCall.
 *
 * CommonJS `require` first: it is what Node's CommonJS build and Jest's module registry load, and a
 * native `import()` fails inside Jest without its VM-modules flag. An ES module build has no
 * `require` (a bundler's stand-in throws), so it falls back to `import()`.
 */
async function importAtRuntime(specifier: string): Promise<unknown> {
  if (typeof require === 'function') {
    try {
      return require(specifier) as unknown;
    } catch {
      // No CommonJS loader for it here: try the ES module loader.
    }
  }
  return import(specifier);
}

/** Whether this code runs in Cloudflare Workers, by the runtime's own documented identity. */
export function isCloudflareWorkersRuntime(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: unknown } }).navigator;
  return nav?.userAgent === 'Cloudflare-Workers';
}

const UNAVAILABLE_IN_WORKERS =
  "CodeCall vm.runtime 'node-vm' needs Node.js (node:vm); it is not available in Cloudflare Workers. " +
  "Set vm.runtime: 'interpreter' to run scripts in a Worker.";

/** How the runtime loads the barrel; replaced in tests. */
export type NodeVmModuleLoader = () => Promise<NodeVmModule>;

const loadNodeVmModule: NodeVmModuleLoader = async () => (await importAtRuntime(NODE_VM_PACKAGE)) as NodeVmModule;

/** The Enclave options for a run spec: the CodeCall configuration this runtime has always used. */
export function toEnclaveOptions(spec: CodeCallScriptRunSpec): CreateEnclaveOptions {
  const { threshold, overrides } = spec.rapidEnumeration;
  return {
    securityLevel: CODECALL_ENCLAVE_SECURITY_LEVEL,
    timeout: spec.timeoutMs,
    maxToolCalls: spec.maxToolCalls,
    maxIterations: spec.maxIterations,
    maxSanitizeDepth: spec.maxSanitizeDepth,
    maxSanitizeProperties: spec.maxSanitizeProperties,
    toolHandler: spec.toolHandler,
    validate: true,
    transform: true,
    sidecar: spec.sidecar,
    // Error stacks name no host file, whatever stage raised them.
    sanitizeStackTraces: true,
    // getTool, mcpLog and mcpNotify are host functions: every call goes through the enclave's
    // global-function gate (abort state, call budget, sanitized results).
    allowFunctionsInGlobals: true,
    consoleHandler: spec.consoleHandler,
    globals: { ...spec.hostFunctions },
    // A namespace method call is exactly `callTool('ns.method', args, options)` in the sandbox,
    // with its tool-call cap, rate limit, suspicious-sequence checks and `throwOnError`.
    toolNamespaces: spec.toolNamespaces,
    review: spec.review,
    doubleVm: {
      parentValidation: {
        ...(threshold !== undefined && { rapidEnumerationThreshold: threshold }),
        ...(overrides !== undefined && { rapidEnumerationOverrides: overrides }),
      },
    },
  };
}

/**
 * An enclave for these options. The sandbox refuses a whole `toolNamespaces` configuration over one
 * name it can't bind; the service leaves such names out, and should one still get through, the
 * script runs without namespaces rather than failing (`callTool()` always works).
 */
function createEnclave(module: NodeVmModule, options: CreateEnclaveOptions): Pick<Enclave, 'run' | 'dispose'> {
  try {
    return new module.Enclave(options);
  } catch (error: unknown) {
    if (
      !options.toolNamespaces ||
      !(error instanceof TypeError) ||
      !error.message.startsWith('Invalid toolNamespaces')
    ) {
      throw error;
    }
    return new module.Enclave({ ...options, toolNamespaces: undefined });
  }
}

/** The `node-vm` runtime. */
export function createNodeVmRuntime(loader: NodeVmModuleLoader = loadNodeVmModule): CodeCallScriptRuntime {
  return {
    name: 'node-vm',
    async createRunner(spec: CodeCallScriptRunSpec): Promise<CodeCallScriptRunner> {
      if (isCloudflareWorkersRuntime()) {
        throw new CodeCallRuntimeError('RUNTIME_UNAVAILABLE', 'node-vm', UNAVAILABLE_IN_WORKERS);
      }
      let module: NodeVmModule;
      try {
        module = await loader();
      } catch {
        throw new CodeCallRuntimeError(
          'RUNTIME_UNAVAILABLE',
          'node-vm',
          `CodeCall vm.runtime 'node-vm' could not load ${NODE_VM_PACKAGE}: it needs Node.js with node:vm. ` +
            "Set vm.runtime: 'interpreter' outside Node.js.",
        );
      }
      if (typeof module?.Enclave !== 'function') {
        throw new CodeCallRuntimeError(
          'RUNTIME_UNAVAILABLE',
          'node-vm',
          `CodeCall vm.runtime 'node-vm' could not load ${NODE_VM_PACKAGE}: it exports no Enclave here.`,
        );
      }
      if (spec.review && module.REVIEW_ERROR_CODES === undefined) {
        throw new CodeCallRuntimeError(
          'RUNTIME_FEATURE_UNSUPPORTED',
          'node-vm',
          `CodeCall review needs ${NODE_VM_PACKAGE} 2.21 or later, which runs review hooks; the script was not run.`,
        );
      }
      const enclave = createEnclave(module, toEnclaveOptions(spec));
      return {
        run: (code) => enclave.run<unknown>(code, undefined, { reviewContext: spec.reviewContext }),
        dispose: () => enclave.dispose(),
      };
    },
  };
}
