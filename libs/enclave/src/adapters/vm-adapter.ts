/**
 * VM Adapter - Node.js vm module implementation
 *
 * Uses Node.js built-in vm module for sandboxed code execution.
 * Provides isolated execution context with controlled globals.
 *
 * @packageDocumentation
 */

import * as vm from 'vm';
import type { SandboxAdapter, ExecutionContext, ExecutionResult, SecurityLevel } from '../types';
import { createSafeRuntime } from '../safe-runtime';
import { createSafeReflect } from '../secure-proxy';

/**
 * Sensitive patterns to redact from stack traces
 * Security: Prevents information leakage about host environment
 *
 * Categories covered:
 * - File system paths (Unix, Windows, UNC)
 * - Cloud environment variables and metadata
 * - Container/orchestration paths
 * - CI/CD system paths
 * - User home directories
 * - Secret/credential patterns
 * - Internal hostnames and IPs
 * - Package manager cache paths
 */
const SENSITIVE_STACK_PATTERNS = [
  // Unix file system paths
  /\/Users\/[^/]+\/[^\s):]*/gi, // macOS home directories
  /\/home\/[^/]+\/[^\s):]*/gi, // Linux home directories
  /\/var\/[^\s):]*/gi, // System var directories
  /\/opt\/[^\s):]*/gi, // Optional software
  /\/tmp\/[^\s):]*/gi, // Temporary files
  /\/etc\/[^\s):]*/gi, // System configuration
  /\/root\/[^\s):]*/gi, // Root home directory
  /\/mnt\/[^\s):]*/gi, // Mount points
  /\/srv\/[^\s):]*/gi, // Service data
  /\/data\/[^\s):]*/gi, // Data directories
  /\/app\/[^\s):]*/gi, // Application directories
  /\/proc\/[^\s):]*/gi, // Process information
  /\/sys\/[^\s):]*/gi, // System files

  // Windows paths
  /\\\\[^\s):]*/g, // UNC paths
  /[A-Z]:\\[^\s):]+/gi, // Windows drive paths

  // URL-based paths
  /file:\/\/[^\s):]+/gi, // File URLs
  /webpack:\/\/[^\s):]+/gi, // Webpack paths
  /%2F[^\s):]+/gi, // URL-encoded paths

  // Package managers and node
  /node_modules\/[^\s):]+/gi, // Node modules paths
  /\/nix\/store\/[^\s):]*/gi, // Nix store paths
  /\.npm\/[^\s):]*/gi, // NPM cache
  /\.yarn\/[^\s):]*/gi, // Yarn cache
  /\.pnpm\/[^\s):]*/gi, // PNPM cache

  // Container and orchestration
  /\/run\/secrets\/[^\s):]*/gi, // Docker/K8s secrets
  /\/var\/run\/[^\s):]*/gi, // Runtime directories
  /\/docker\/[^\s):]*/gi, // Docker paths
  /\/containers\/[^\s):]*/gi, // Container paths
  /\/kubelet\/[^\s):]*/gi, // Kubernetes kubelet

  // CI/CD systems
  /\/github\/workspace\/[^\s):]*/gi, // GitHub Actions
  /\/runner\/[^\s):]*/gi, // GitHub/GitLab runner
  /\/builds\/[^\s):]*/gi, // CI builds
  /\/workspace\/[^\s):]*/gi, // Generic workspace
  /\/pipeline\/[^\s):]*/gi, // CI pipelines
  /\/jenkins\/[^\s):]*/gi, // Jenkins
  /\/bamboo\/[^\s):]*/gi, // Bamboo
  /\/teamcity\/[^\s):]*/gi, // TeamCity
  /\/circleci\/[^\s):]*/gi, // CircleCI

  // Cloud providers
  /\/aws\/[^\s):]*/gi, // AWS paths
  /\/gcloud\/[^\s):]*/gi, // Google Cloud
  /\/azure\/[^\s):]*/gi, // Azure paths
  /s3:\/\/[^\s):]+/gi, // S3 URIs
  /gs:\/\/[^\s):]+/gi, // GCS URIs

  // Secrets and credentials (patterns that might appear in paths or errors)
  /[A-Z0-9]{20,}/g, // AWS-style access keys (20+ uppercase chars)
  /sk-[a-zA-Z0-9]{32,}/g, // OpenAI/Stripe-style secret keys
  /ghp_[a-zA-Z0-9]{36,}/g, // GitHub personal access tokens
  /gho_[a-zA-Z0-9]{36,}/g, // GitHub OAuth tokens
  /github_pat_[a-zA-Z0-9_]{22,}/g, // GitHub fine-grained tokens
  /xox[baprs]-[a-zA-Z0-9-]+/g, // Slack tokens
  /Bearer\s+[a-zA-Z0-9._-]+/gi, // Bearer tokens
  /Basic\s+[a-zA-Z0-9+/=]+/gi, // Basic auth

  // Internal network info
  /(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+/g, // Private IPs
  /[a-z0-9-]+\.internal(?:\.[a-z]+)?/gi, // Internal hostnames
  /localhost:\d+/gi, // Localhost with port
  /127\.0\.0\.1:\d+/gi, // Loopback with port

  // User information
  /\/u\/[^/]+\//gi, // User subdirectories
  /~[a-z_][a-z0-9_-]*/gi, // Unix user home shorthand
];

/**
 * Sanitize stack trace by removing host file system paths
 * Security: Prevents information leakage about host environment
 *
 * When enabled (sanitize=true):
 * - Removes file paths from all supported platforms
 * - Redacts potential secrets and credentials
 * - Strips internal hostnames and IPs
 * - Removes line/column numbers for full anonymization
 *
 * @param stack Original stack trace
 * @param sanitize Whether to sanitize (defaults to true)
 * @returns Sanitized stack trace (or original if sanitize=false)
 */
function sanitizeStackTrace(stack: string | undefined, sanitize = true): string | undefined {
  if (!stack) return stack;

  // Return unsanitized stack if disabled
  if (!sanitize) return stack;

  let sanitized = stack;

  // Apply all sensitive patterns
  for (const pattern of SENSITIVE_STACK_PATTERNS) {
    // Reset lastIndex for global patterns to ensure consistent behavior
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Additional: Remove line and column numbers from stack frames
  // Format: "at functionName (file:line:column)" -> "at functionName ([REDACTED])"
  sanitized = sanitized.replace(/at\s+([^\s]+)\s+\([^)]*:\d+:\d+\)/g, 'at $1 ([REDACTED])');

  // Format: "at file:line:column" -> "at [REDACTED]"
  sanitized = sanitized.replace(/at\s+[^\s]+:\d+:\d+/g, 'at [REDACTED]');

  return sanitized;
}

/**
 * Protected identifier prefixes that cannot be modified from sandbox code
 * Security: Prevents runtime override attacks on safe functions
 */
const PROTECTED_PREFIXES = ['__safe_', '__ag_'];

/**
 * Console statistics for tracking I/O flood attacks
 * @internal
 */
interface ConsoleStats {
  totalBytes: number;
  callCount: number;
}

/**
 * Create a rate-limited console wrapper
 * Security: Prevents I/O flood attacks via excessive console.log output
 *
 * @param config Configuration with maxConsoleOutputBytes and maxConsoleCalls
 * @param stats Mutable stats object to track output across all console methods
 * @returns Safe console object with rate limiting
 */
function createSafeConsole(
  config: { maxConsoleOutputBytes: number; maxConsoleCalls: number },
  stats: ConsoleStats,
): { log: typeof console.log; error: typeof console.error; warn: typeof console.warn; info: typeof console.info } {
  const wrap =
    (method: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      // Check call count limit BEFORE doing any work
      stats.callCount++;
      if (stats.callCount > config.maxConsoleCalls) {
        throw new Error(
          `Console call limit exceeded (max: ${config.maxConsoleCalls}). ` + `This limit prevents I/O flood attacks.`,
        );
      }

      // Calculate output size
      const output = args
        .map((a) => {
          if (a === undefined) return 'undefined';
          if (a === null) return 'null';
          if (typeof a === 'object') {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(' ');

      // Check output size limit
      stats.totalBytes += output.length;
      if (stats.totalBytes > config.maxConsoleOutputBytes) {
        throw new Error(
          `Console output size limit exceeded (max: ${config.maxConsoleOutputBytes} bytes). ` +
            `This limit prevents I/O flood attacks.`,
        );
      }

      // Safe to call the real console method
      method(...args);
    };

  return {
    log: wrap(console.log.bind(console)),
    error: wrap(console.error.bind(console)),
    warn: wrap(console.warn.bind(console)),
    info: wrap(console.info.bind(console)),
  };
}

/**
 * Check if an identifier is protected
 */
function isProtectedIdentifier(prop: string | symbol): boolean {
  if (typeof prop !== 'string') return false;
  return PROTECTED_PREFIXES.some((prefix) => prop.startsWith(prefix));
}

/**
 * Create a protected sandbox context using Proxy
 * Security: Prevents runtime reassignment of __safe_* and __ag_* functions
 *
 * @param sandbox The original VM context sandbox
 * @returns A proxy that protects reserved identifiers from modification
 */
function createProtectedSandbox(sandbox: vm.Context): vm.Context {
  return new Proxy(sandbox, {
    set(target, prop, value) {
      if (isProtectedIdentifier(prop)) {
        throw new Error(
          `Cannot modify protected identifier "${String(prop)}". ` +
            `Identifiers starting with ${PROTECTED_PREFIXES.map((p) => `"${p}"`).join(
              ', ',
            )} are protected runtime functions.`,
        );
      }
      return Reflect.set(target, prop, value);
    },
    defineProperty(target, prop, descriptor) {
      if (isProtectedIdentifier(prop)) {
        throw new Error(
          `Cannot define protected identifier "${String(prop)}". ` +
            `Identifiers starting with ${PROTECTED_PREFIXES.map((p) => `"${p}"`).join(
              ', ',
            )} are protected runtime functions.`,
        );
      }
      return Reflect.defineProperty(target, prop, descriptor);
    },
    deleteProperty(target, prop) {
      if (isProtectedIdentifier(prop)) {
        throw new Error(
          `Cannot delete protected identifier "${String(prop)}". ` +
            `Identifiers starting with ${PROTECTED_PREFIXES.map((p) => `"${p}"`).join(
              ', ',
            )} are protected runtime functions.`,
        );
      }
      return Reflect.deleteProperty(target, prop);
    },
  });
}

/**
 * Node.js 24 dangerous globals that should be removed per security level
 * These globals can be used for various escape/attack vectors
 */
const NODEJS_24_DANGEROUS_GLOBALS: Record<SecurityLevel, string[]> = {
  STRICT: [
    'Iterator',
    'AsyncIterator',
    'ShadowRealm',
    'WeakRef',
    'FinalizationRegistry',
    'Reflect',
    'Proxy',
    'performance',
    'Temporal',
  ],
  SECURE: ['Iterator', 'AsyncIterator', 'ShadowRealm', 'WeakRef', 'FinalizationRegistry', 'Proxy'],
  STANDARD: ['ShadowRealm', 'WeakRef', 'FinalizationRegistry'],
  PERMISSIVE: ['ShadowRealm'],
};

/**
 * Sanitize VM context by removing dangerous Node.js 24 globals
 * Security: Prevents escape via new APIs like Iterator helpers, ShadowRealm, etc.
 *
 * @param context The VM context to sanitize
 * @param securityLevel The security level to determine which globals to remove
 */
function sanitizeVmContext(context: vm.Context, securityLevel: SecurityLevel): void {
  const globalsToRemove = NODEJS_24_DANGEROUS_GLOBALS[securityLevel];

  for (const global of globalsToRemove) {
    // Delete the global if it exists in the context
    if (global in context) {
      try {
        delete context[global];
      } catch {
        // Some globals may be non-configurable, set to undefined instead
        try {
          context[global] = undefined;
        } catch {
          // Ignore if we can't modify it
        }
      }
    }
  }

  // For security levels that allow Reflect, provide a safe version
  if (securityLevel !== 'STRICT') {
    const safeReflect = createSafeReflect(securityLevel);
    if (safeReflect) {
      Object.defineProperty(context, 'Reflect', {
        value: safeReflect,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    }
  }
}

/**
 * VM-based sandbox adapter
 *
 * Uses Node.js vm module to execute AgentScript code in an isolated context.
 * Injects safe runtime wrappers and controls available globals.
 */
export class VmAdapter implements SandboxAdapter {
  private context?: vm.Context;
  private readonly securityLevel: SecurityLevel;

  constructor(securityLevel: SecurityLevel = 'STANDARD') {
    this.securityLevel = securityLevel;
  }

  /**
   * Execute code in the VM sandbox
   *
   * @param code Transformed AgentScript code to execute
   * @param executionContext Execution context with config and handlers
   * @returns Execution result
   */
  async execute<T = unknown>(code: string, executionContext: ExecutionContext): Promise<ExecutionResult<T>> {
    const { stats, config } = executionContext;
    const startTime = Date.now();

    try {
      // Create safe runtime context with optional sidecar support and proxy config
      const safeRuntime = createSafeRuntime(executionContext, {
        sidecar: executionContext.sidecar,
        referenceConfig: executionContext.referenceConfig,
        secureProxyConfig: executionContext.secureProxyConfig,
      });

      // Create sandbox context with safe globals only
      // IMPORTANT: Use empty object to get NEW isolated prototypes
      const baseSandbox = vm.createContext({});

      // Sanitize the VM context by removing dangerous Node.js 24 globals
      // Security: Prevents escape via Iterator helpers, ShadowRealm, etc.
      sanitizeVmContext(baseSandbox, this.securityLevel);

      // Add safe runtime functions to the isolated context as non-writable, non-configurable
      // Security: Prevents runtime override attacks on __safe_* functions
      for (const [key, value] of Object.entries(safeRuntime)) {
        Object.defineProperty(baseSandbox, key, {
          value: value,
          writable: false,
          configurable: false,
          enumerable: true,
        });
      }

      // Add user-provided globals (if any)
      // These are NOT protected - users can modify their own globals
      if (config.globals) {
        for (const [key, value] of Object.entries(config.globals)) {
          (baseSandbox as any)[key] = value;
        }
      }

      // Add __safe_console with rate limiting to prevent I/O flood attacks
      // Security: Limits total output bytes and call count
      // Note: The agentscript transformer converts `console` → `__safe_console` in whitelist mode
      // Skip if user already provided console via globals (already added with __safe_ prefix by safeRuntime)
      if (!('__safe_console' in safeRuntime)) {
        const consoleStats: ConsoleStats = { totalBytes: 0, callCount: 0 };
        Object.defineProperty(baseSandbox, '__safe_console', {
          value: createSafeConsole(
            {
              maxConsoleOutputBytes: config.maxConsoleOutputBytes,
              maxConsoleCalls: config.maxConsoleCalls,
            },
            consoleStats,
          ),
          writable: false,
          configurable: false,
          enumerable: true,
        });
      }

      // Wrap sandbox in protective Proxy to catch dynamic assignment attempts
      // Security: Prevents dynamic assignment like `this['__safe_callTool'] = malicious`
      const sandbox = createProtectedSandbox(baseSandbox);

      // Store context reference for disposal
      // Note: Each execute() call creates a fresh context for isolation
      // The stored reference is only used by dispose() for cleanup
      this.context = baseSandbox;

      // Wrap code in async IIFE to handle top-level await
      const wrappedCode = `
        (async () => {
          ${code}
          return typeof __ag_main === 'function' ? await __ag_main() : undefined;
        })();
      `;

      // Compile script
      const script = new vm.Script(wrappedCode, {
        filename: 'agentscript.js',
      });

      // Execute script with timeout
      const resultPromise = script.runInContext(this.context, {
        timeout: config.timeout,
        breakOnSigint: true,
      });

      // Wait for result
      const value = await resultPromise;

      // Update stats
      stats.duration = Date.now() - startTime;
      stats.endTime = Date.now();

      return {
        success: true,
        value: value as T,
        stats,
      };
    } catch (error: unknown) {
      const err = error as Error;

      // Update stats
      stats.duration = Date.now() - startTime;
      stats.endTime = Date.now();

      // Determine whether to sanitize stack traces based on config
      // Default to true for backwards compatibility if not explicitly set
      const shouldSanitize = config.sanitizeStackTraces ?? true;

      return {
        success: false,
        error: {
          name: err.name || 'VMExecutionError',
          message: err.message || 'Unknown VM execution error',
          stack: sanitizeStackTrace(err.stack, shouldSanitize),
          code: 'VM_EXECUTION_ERROR',
        },
        stats,
      };
    }
  }

  /**
   * Dispose the VM context and cleanup resources
   */
  dispose(): void {
    // VM contexts are garbage collected automatically
    this.context = undefined;
  }
}
