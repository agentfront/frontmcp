import { FrontMcpLogger } from '../../common/interfaces/logger.interface';

export interface EnclaveOptions {
  timeout?: number;
  maxIterations?: number;
}

/**
 * Bridge to @enclave-vm/core for executing dynamic job scripts in a sandbox.
 * Lazy-requires the enclave package (peerDependency).
 */
export class JobEnclaveBridge {
  private readonly logger: FrontMcpLogger;
  private readonly options: EnclaveOptions;
  private enclaveCore: any;

  constructor(logger: FrontMcpLogger, options: EnclaveOptions = {}) {
    this.logger = logger;
    this.options = {
      timeout: options.timeout ?? 30000,
      maxIterations: options.maxIterations ?? 1000,
    };
  }

  /**
   * Lazy-load @enclave-vm/core.
   */
  private getEnclaveCore(): any {
    if (!this.enclaveCore) {
      try {
        this.enclaveCore = require('@enclave-vm/core');
      } catch {
        throw new Error(
          'Missing optional dependency: dynamic jobs require @enclave-vm/core. Install it with: npm install @enclave-vm/core',
        );
      }
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
    const enclave = this.getEnclaveCore();
    const { Sandbox } = enclave;

    const sandbox = new Sandbox({
      timeout: this.options.timeout,
      maxIterations: this.options.maxIterations,
    });

    // Inject sandbox-safe APIs
    const globals: Record<string, unknown> = {
      input: JSON.parse(JSON.stringify(input)),
      console: {
        log: (...args: unknown[]) => context.mcpLog?.('info', args.map(String).join(' ')),
        warn: (...args: unknown[]) => context.mcpLog?.('warning', args.map(String).join(' ')),
        error: (...args: unknown[]) => context.mcpLog?.('error', args.map(String).join(' ')),
      },
    };

    if (context.callTool) {
      globals['callTool'] = context.callTool;
    }
    if (context.getTool) {
      globals['getTool'] = context.getTool;
    }

    try {
      const result = await sandbox.run(script, globals);
      return result;
    } catch (err) {
      this.logger.error(`Enclave execution failed: ${err}`);
      throw err;
    } finally {
      sandbox.dispose?.();
    }
  }
}
