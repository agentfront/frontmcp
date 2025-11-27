/**
 * Enclave - Safe AgentScript Execution Environment
 *
 * Provides a sandboxed environment for executing AgentScript code with:
 * - AST validation
 * - Code transformation
 * - Runtime safety wrappers
 * - Resource limits (timeout, memory, iterations)
 * - Pass-by-reference support for large data
 *
 * @packageDocumentation
 */

import { JSAstValidator, createAgentScriptPreset } from 'ast-guard';
import { transformAgentScript, isWrappedInMain } from 'ast-guard';
import { extractLargeStrings, transformConcatenation, transformTemplateLiterals } from 'ast-guard';
import * as acorn from 'acorn';
import { generate } from 'astring';
import type {
  EnclaveConfig,
  CreateEnclaveOptions,
  ExecutionResult,
  ExecutionContext,
  ExecutionStats,
  SandboxAdapter,
  ToolHandler,
  SecurityLevel,
  SecurityLevelConfig,
  ReferenceSidecarOptions,
} from './types';
import type { WorkerPoolConfig } from './adapters/worker-pool/config';
import { SECURITY_LEVEL_CONFIGS } from './types';
import { createSafeRuntime } from './safe-runtime';
import { validateGlobals } from './globals-validator';
import { ReferenceSidecar } from './sidecar/reference-sidecar';
import { REFERENCE_CONFIGS, ReferenceConfig } from './sidecar/reference-config';
import { ScoringGate } from './scoring/scoring-gate';
import type { ScoringGateConfig, ScoringGateResult } from './scoring/types';

/**
 * Default security level
 */
const DEFAULT_SECURITY_LEVEL: SecurityLevel = 'STANDARD';

/**
 * Get merged configuration from security level and explicit options
 * Explicit options override security level defaults
 */
function getConfigFromSecurityLevel(
  securityLevel: SecurityLevel,
  options: CreateEnclaveOptions
): {
  timeout: number;
  maxIterations: number;
  maxToolCalls: number;
  sanitizeStackTraces: boolean;
  maxSanitizeDepth: number;
  maxSanitizeProperties: number;
  allowFunctionsInGlobals: boolean;
  maxConsoleOutputBytes: number;
  maxConsoleCalls: number;
} {
  const levelConfig = SECURITY_LEVEL_CONFIGS[securityLevel];

  return {
    timeout: options.timeout ?? levelConfig.timeout,
    maxIterations: options.maxIterations ?? levelConfig.maxIterations,
    maxToolCalls: options.maxToolCalls ?? levelConfig.maxToolCalls,
    sanitizeStackTraces: options.sanitizeStackTraces ?? levelConfig.sanitizeStackTraces,
    maxSanitizeDepth: options.maxSanitizeDepth ?? levelConfig.maxSanitizeDepth,
    maxSanitizeProperties: options.maxSanitizeProperties ?? levelConfig.maxSanitizeProperties,
    allowFunctionsInGlobals: options.allowFunctionsInGlobals ?? levelConfig.allowFunctionsInGlobals,
    maxConsoleOutputBytes: options.maxConsoleOutputBytes ?? levelConfig.maxConsoleOutputBytes,
    maxConsoleCalls: options.maxConsoleCalls ?? levelConfig.maxConsoleCalls,
  };
}

/**
 * Base configuration values (non-security-level dependent)
 */
const BASE_CONFIG = {
  memoryLimit: 128 * 1024 * 1024, // 128MB
  adapter: 'vm' as const,
  allowBuiltins: false,
  globals: {},
  toolHandler: undefined as ToolHandler | undefined,
};

/**
 * Build reference config from security level and sidecar options
 */
function buildReferenceConfig(
  securityLevel: SecurityLevel,
  sidecarOptions?: ReferenceSidecarOptions,
): ReferenceConfig | undefined {
  if (!sidecarOptions?.enabled) {
    return undefined;
  }

  const baseConfig = REFERENCE_CONFIGS[securityLevel];

  return {
    maxTotalSize: sidecarOptions.maxTotalSize ?? baseConfig.maxTotalSize,
    maxReferenceSize: sidecarOptions.maxReferenceSize ?? baseConfig.maxReferenceSize,
    extractionThreshold: sidecarOptions.extractionThreshold ?? baseConfig.extractionThreshold,
    maxResolvedSize: sidecarOptions.maxResolvedSize ?? baseConfig.maxResolvedSize,
    allowComposites: sidecarOptions.allowComposites ?? baseConfig.allowComposites,
    maxReferenceCount: sidecarOptions.maxReferenceCount ?? baseConfig.maxReferenceCount,
    maxResolutionDepth: baseConfig.maxResolutionDepth,
  };
}

/**
 * Enclave - Safe AgentScript Execution Environment
 *
 * @example
 * ```typescript
 * import { Enclave } from '@frontmcp/enclave';
 *
 * // Create enclave with tool handler
 * const enclave = new Enclave({
 *   timeout: 5000,
 *   maxToolCalls: 50,
 *   toolHandler: async (toolName, args) => {
 *     // Handle tool calls
 *     return { result: 'data' };
 *   },
 * });
 *
 * // Execute AgentScript code
 * const code = `
 *   const users = await callTool('users:list', {});
 *   return users.items.length;
 * `;
 *
 * const result = await enclave.run(code);
 * console.log(result.value); // Number of users
 * ```
 */
export class Enclave {
  private readonly config: Omit<Required<EnclaveConfig>, 'toolHandler'> & {
    toolHandler?: ToolHandler;
    sanitizeStackTraces: boolean;
    maxSanitizeDepth: number;
    maxSanitizeProperties: number;
    maxConsoleOutputBytes: number;
    maxConsoleCalls: number;
    workerPoolConfig?: Partial<WorkerPoolConfig>;
  };
  private readonly securityLevel: SecurityLevel;
  private readonly validator: JSAstValidator;
  private readonly validateCode: boolean;
  private readonly transformCode: boolean;
  private readonly referenceConfig?: ReferenceConfig;
  private readonly scoringGate?: ScoringGate;
  private adapter?: SandboxAdapter;

  constructor(options: CreateEnclaveOptions = {}) {
    // Determine security level (default: STANDARD)
    this.securityLevel = options.securityLevel ?? DEFAULT_SECURITY_LEVEL;

    // Get configuration from security level, with explicit options overriding
    const securityConfig = getConfigFromSecurityLevel(this.securityLevel, options);

    // Validate custom globals before use
    // Security: Prevents function injection, getters/setters, and dangerous patterns
    if (options.globals) {
      validateGlobals(options.globals, {
        maxDepth: 10,
        allowFunctions: securityConfig.allowFunctionsInGlobals,
        allowGettersSetters: false,
      });
    }

    // Merge with defaults, applying security level configuration
    this.config = {
      ...BASE_CONFIG,
      timeout: securityConfig.timeout,
      maxIterations: securityConfig.maxIterations,
      maxToolCalls: securityConfig.maxToolCalls,
      sanitizeStackTraces: securityConfig.sanitizeStackTraces,
      maxSanitizeDepth: securityConfig.maxSanitizeDepth,
      maxSanitizeProperties: securityConfig.maxSanitizeProperties,
      maxConsoleOutputBytes: securityConfig.maxConsoleOutputBytes,
      maxConsoleCalls: securityConfig.maxConsoleCalls,
      ...options,
      globals: {
        ...BASE_CONFIG.globals,
        ...options.globals,
      },
    };

    // Create validator with custom globals
    // Extract custom global names from options
    const customGlobalNames = options.globals ? Object.keys(options.globals) : [];

    // For each custom global, we need to whitelist both:
    // 1. The original name (customValue)
    // 2. The transformed name (__safe_customValue)
    const customAllowedGlobals = customGlobalNames.flatMap(name => [
      name,
      `__safe_${name}`,
    ]);

    this.validator = new JSAstValidator(createAgentScriptPreset({
      allowedGlobals: [
        'callTool',
        'parallel',
        'Math',
        'JSON',
        'Array',
        'Object',
        'String',
        'Number',
        'Date',
        'console',
        '__safe_callTool',
        '__safe_forOf',
        '__safe_for',
        '__safe_while',
        '__safe_doWhile',
        '__safe_concat',
        '__safe_template',
        '__safe_parallel',
        '__safe_console', // Transformed console with rate limiting
        ...customAllowedGlobals,
      ],
    }));

    // Configuration flags
    this.validateCode = options.validate !== false; // Default: true
    this.transformCode = options.transform !== false; // Default: true

    // Build reference config if sidecar is enabled
    this.referenceConfig = buildReferenceConfig(this.securityLevel, options.sidecar);

    // Initialize scoring gate if configured
    if (options.scoringGate && options.scoringGate.scorer !== 'disabled') {
      this.scoringGate = new ScoringGate(options.scoringGate);
    }

    // Adapter will be lazy-loaded based on config.adapter
  }

  /**
   * Initialize async components (scoring gate, etc.)
   *
   * Call this before run() if using scorers that require initialization
   * (e.g., local-llm needs to download the model)
   */
  async initialize(): Promise<void> {
    await this.scoringGate?.initialize();
  }

  /**
   * Execute AgentScript code
   *
   * @param code AgentScript code to execute
   * @param toolHandler Optional tool handler (overrides constructor config)
   * @returns Execution result
   */
  async run<T = unknown>(
    code: string,
    toolHandler?: ToolHandler
  ): Promise<ExecutionResult<T>> {
    const startTime = Date.now();

    // Initialize stats
    const stats: ExecutionStats = {
      duration: 0,
      toolCallCount: 0,
      iterationCount: 0,
      startTime,
      endTime: 0,
    };

    // Create sidecar for this execution if enabled
    const sidecar = this.referenceConfig
      ? new ReferenceSidecar(this.referenceConfig)
      : undefined;

    try {
      // Step 1: Transform (if enabled) - MUST happen before validation
      // because AgentScript allows top-level return, await, etc. which are only
      // valid after wrapping in async function __ag_main()
      let transformedCode = code;
      if (this.transformCode) {
        // Check if already wrapped
        const needsWrapping = !isWrappedInMain(code);

        transformedCode = transformAgentScript(code, {
          wrapInMain: needsWrapping,
          transformCallTool: true,
          transformLoops: true,
        });
      }

      // Step 1.5: Apply sidecar transforms if enabled
      // These transforms extract large strings and convert concatenation to safe calls
      if (sidecar && this.referenceConfig) {
        transformedCode = this.applySidecarTransforms(transformedCode, sidecar);
      }

      // Step 2: Validate (if enabled) - validate TRANSFORMED code
      if (this.validateCode) {
        const validationResult = await this.validator.validate(transformedCode);
        if (!validationResult.valid) {
          const errorMessages = validationResult.issues
            .map((issue) => `${issue.code}: ${issue.message}`)
            .join('\n');

          return {
            success: false,
            error: {
              name: 'ValidationError',
              message: `AgentScript validation failed:\n${errorMessages}`,
              code: 'VALIDATION_ERROR',
              data: { issues: validationResult.issues },
            },
            stats: {
              ...stats,
              duration: Date.now() - startTime,
              endTime: Date.now(),
            },
          };
        }
      }

      // Step 2.5: AI Scoring Gate (if configured)
      // This runs AFTER AST validation but BEFORE code execution
      let scoringResult: ScoringGateResult | undefined;
      if (this.scoringGate) {
        scoringResult = await this.scoringGate.evaluate(transformedCode);

        if (!scoringResult.allowed) {
          const signalSummary = scoringResult.signals
            ?.map(s => `${s.id}: ${s.description}`)
            .join('; ') ?? 'Unknown risk';

          return {
            success: false,
            error: {
              name: 'ScoringGateError',
              message: `Script blocked by AI scoring (score: ${scoringResult.totalScore}): ${signalSummary}`,
              code: 'SCORING_BLOCKED',
              data: {
                totalScore: scoringResult.totalScore,
                riskLevel: scoringResult.riskLevel,
                signals: scoringResult.signals,
              },
            },
            stats: {
              ...stats,
              duration: Date.now() - startTime,
              endTime: Date.now(),
            },
            scoringResult,
          };
        }
      }

      // Step 3: Create execution context
      const context: ExecutionContext = {
        config: this.config,
        stats,
        abortController: new AbortController(),
        aborted: false,
        toolHandler: toolHandler || this.config.toolHandler,
        sidecar,
        referenceConfig: this.referenceConfig,
      };

      // Set up timeout
      const timeoutId = setTimeout(() => {
        context.aborted = true;
        context.abortController.abort();
      }, this.config.timeout);

      try {
        // Step 4: Execute in sandbox
        const adapter = await this.getAdapter();
        const result = await adapter.execute<T>(transformedCode, context);

        // Clear timeout
        clearTimeout(timeoutId);

        // Include scoring result in successful execution
        if (scoringResult) {
          return { ...result, scoringResult };
        }

        return result;
      } catch (error: unknown) {
        // Clear timeout
        clearTimeout(timeoutId);

        const err = error as Error;
        return {
          success: false,
          error: {
            name: err.name || 'ExecutionError',
            message: err.message || 'Unknown execution error',
            stack: err.stack,
            code: 'EXECUTION_ERROR',
          },
          stats: {
            ...stats,
            duration: Date.now() - startTime,
            endTime: Date.now(),
          },
        };
      }
    } catch (error: unknown) {
      const err = error as Error;
      return {
        success: false,
        error: {
          name: err.name || 'EnclaveError',
          message: err.message || 'Unknown enclave error',
          stack: err.stack,
          code: 'ENCLAVE_ERROR',
        },
        stats: {
          ...stats,
          duration: Date.now() - startTime,
          endTime: Date.now(),
        },
      };
    } finally {
      // Always dispose the sidecar to prevent memory leaks
      if (sidecar) {
        sidecar.dispose();
      }
    }
  }

  /**
   * Apply sidecar transforms to code
   *
   * Extracts large strings and transforms concatenation to use safe functions.
   *
   * @param code The code to transform
   * @param sidecar The sidecar to store extracted strings
   * @returns The transformed code
   */
  private applySidecarTransforms(code: string, sidecar: ReferenceSidecar): string {
    // Parse the code into an AST
    const ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });

    // Extract large strings (if extraction threshold is set)
    if (this.referenceConfig?.extractionThreshold) {
      extractLargeStrings(ast, {
        threshold: this.referenceConfig.extractionThreshold,
        onExtract: (value) => {
          return sidecar.store(value, 'extraction');
        },
      });
    }

    // Transform concatenation operations (a + b -> __safe_concat(a, b))
    transformConcatenation(ast);

    // Transform template literals (`Hello ${name}` -> __safe_template(['Hello ', ''], name))
    transformTemplateLiterals(ast);

    // Generate code from the transformed AST
    return generate(ast);
  }

  /**
   * Get or create the sandbox adapter
   */
  private async getAdapter(): Promise<SandboxAdapter> {
    if (this.adapter) {
      return this.adapter;
    }

    // Lazy-load adapter based on configuration
    switch (this.config.adapter) {
      case 'vm': {
        const { VmAdapter } = await import('./adapters/vm-adapter.js');
        this.adapter = new VmAdapter();
        return this.adapter!;
      }

      case 'isolated-vm':
        throw new Error('isolated-vm adapter not yet implemented');

      case 'worker_threads': {
        const { WorkerPoolAdapter } = await import('./adapters/worker-pool/index.js');
        this.adapter = new WorkerPoolAdapter(
          this.config.workerPoolConfig,
          this.securityLevel
        );
        await (this.adapter as { initialize?: () => Promise<void> }).initialize?.();
        return this.adapter!;
      }

      default:
        throw new Error(`Unknown adapter: ${this.config.adapter}`);
    }
  }

  /**
   * Get the current security level
   *
   * @returns The security level this enclave was configured with
   */
  getSecurityLevel(): SecurityLevel {
    return this.securityLevel;
  }

  /**
   * Get the effective configuration
   *
   * Useful for debugging and understanding what settings are active
   *
   * @returns A copy of the current configuration
   */
  getEffectiveConfig(): {
    securityLevel: SecurityLevel;
    timeout: number;
    maxIterations: number;
    maxToolCalls: number;
    sanitizeStackTraces: boolean;
    maxSanitizeDepth: number;
    maxSanitizeProperties: number;
    memoryLimit: number;
  } {
    return {
      securityLevel: this.securityLevel,
      timeout: this.config.timeout,
      maxIterations: this.config.maxIterations,
      maxToolCalls: this.config.maxToolCalls,
      sanitizeStackTraces: this.config.sanitizeStackTraces,
      maxSanitizeDepth: this.config.maxSanitizeDepth,
      maxSanitizeProperties: this.config.maxSanitizeProperties,
      memoryLimit: this.config.memoryLimit,
    };
  }

  /**
   * Dispose the enclave and cleanup resources
   */
  dispose(): void {
    if (this.adapter) {
      this.adapter.dispose();
      this.adapter = undefined;
    }
    this.scoringGate?.dispose();
  }

  /**
   * Get scoring gate statistics (if configured)
   */
  getScoringStats(): ReturnType<ScoringGate['getCacheStats']> | null {
    return this.scoringGate?.getCacheStats() ?? null;
  }
}

/**
 * Convenience function to create an enclave and run code in one step
 *
 * @param code AgentScript code to execute
 * @param options Enclave configuration options
 * @returns Execution result
 */
export async function runAgentScript<T = unknown>(
  code: string,
  options: CreateEnclaveOptions = {}
): Promise<ExecutionResult<T>> {
  const enclave = new Enclave(options);
  try {
    return await enclave.run<T>(code);
  } finally {
    enclave.dispose();
  }
}
