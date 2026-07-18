import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { EnclaveExecutionError } from '../../errors';

export interface EnclaveOptions {
  timeout?: number;
  maxIterations?: number;
}

/** Minimal shape of the @enclave-vm/core module. */
interface EnclaveCore {
  Sandbox: new (opts: { timeout?: number; maxIterations?: number }) => {
    run(script: string, globals: Record<string, unknown>): Promise<unknown>;
    dispose?(): void;
  };
}

/**
 * Bridge to @enclave-vm/core for executing dynamic job scripts in a sandbox.
 * Lazy-requires the enclave package (peerDependency).
 */
export class JobEnclaveBridge {
  private readonly logger: FrontMcpLogger;
  private readonly options: EnclaveOptions;
  private enclaveCore: EnclaveCore | undefined;

  constructor(logger: FrontMcpLogger, options: EnclaveOptions = {}) {
    this.logger = logger;
    this.options = {
      timeout: options.timeout ?? 30000,
      maxIterations: options.maxIterations ?? 1000,
    };
  }

  /**
   * Lazy-load @enclave-vm/core.
   *
   * Uses a dynamic `import()` (not `require`) so the SDK's ESM build stays
   * runtime-agnostic and the bundler can treat the enclave sandbox as a lazy
   * optional dependency, matching the rest of the codebase. The full
   * `@enclave-vm/core` is Node-only (it pulls in the `worker_threads`/`node:vm`
   * adapters); the isolate-safe interpreter lives behind `@enclave-vm/core/worker`.
   */
  private async getEnclaveCore(): Promise<EnclaveCore> {
    if (!this.enclaveCore) {
      let mod: (EnclaveCore & { default?: EnclaveCore }) | undefined;
      try {
        mod = (await import('@enclave-vm/core')) as unknown as EnclaveCore & { default?: EnclaveCore };
      } catch {
        // Only a genuine module-resolution failure lands here — keep the
        // "not installed" message scoped to it (a validation error below must
        // NOT be swallowed and reported as a missing dependency).
        throw new Error(
          'Missing optional dependency: dynamic jobs require @enclave-vm/core. Install it with: npm install @enclave-vm/core',
        );
      }

      // CJS/ESM interop: `Sandbox` sits on the namespace (ESM) or under
      // `default` (CJS default-interop). Validate a usable Sandbox constructor
      // BEFORE caching so getEnclaveCore() can never return an unusable module.
      const core = typeof mod?.Sandbox === 'function' ? mod : mod?.default;
      if (!core || typeof core.Sandbox !== 'function') {
        throw new Error(
          'The installed @enclave-vm/core did not export a usable `Sandbox` constructor. ' +
            'Ensure a compatible @enclave-vm/core version is installed.',
        );
      }
      this.enclaveCore = core;
    }
    return this.enclaveCore;
  }

  /**
   * Execute a script in a sandboxed environment.
   */
  async execute(
    script: string,
    input: unknown,
    context: {
      callTool?: (name: string, args: unknown) => Promise<unknown>;
      getTool?: (name: string) => unknown;
      mcpLog?: (level: string, message: string) => void;
    },
  ): Promise<unknown> {
    const enclave = await this.getEnclaveCore();
    const { Sandbox } = enclave;

    const sandbox = new Sandbox({
      timeout: this.options.timeout,
      maxIterations: this.options.maxIterations,
    });

    // Inject sandbox-safe APIs
    const globals: Record<string, unknown> = {
      input: structuredClone(input ?? null),
      console: {
        log: (...args: unknown[]) => context.mcpLog?.('info', args.map(String).join(' ')),
        warn: (...args: unknown[]) => context.mcpLog?.('warning', args.map(String).join(' ')),
        error: (...args: unknown[]) => context.mcpLog?.('error', args.map(String).join(' ')),
      },
    };

    if (context.callTool) {
      globals['callTool'] = async (name: string, args: unknown) => {
        try {
          return await context.callTool!(name, args);
        } catch (err) {
          throw { message: err instanceof Error ? err.message : String(err), type: 'ToolError' };
        }
      };
    }
    if (context.getTool) {
      globals['getTool'] = (name: string) => {
        try {
          return context.getTool!(name);
        } catch (err) {
          throw { message: err instanceof Error ? err.message : String(err), type: 'ToolError' };
        }
      };
    }

    try {
      const result = await sandbox.run(script, globals);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Enclave execution failed: ${error.message}`);
      throw new EnclaveExecutionError(error.message, error);
    } finally {
      sandbox.dispose?.();
    }
  }
}
