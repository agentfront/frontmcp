/**
 * @frontmcp/enclave - Safe AgentScript Execution Environment
 *
 * Provides sandboxed execution for AgentScript code with:
 * - AST validation using @frontmcp/ast-guard
 * - Code transformation (whitelist-based)
 * - Runtime safety wrappers (__safe_* functions)
 * - Resource limits (timeout, memory, iterations, tool calls)
 * - Multiple sandbox adapters (isolated-vm, vm2, worker_threads)
 *
 * @packageDocumentation
 */

// Main Enclave class
export { Enclave, runAgentScript } from './lib/enclave';

// Types and interfaces
export type {
  ExecutionResult,
  ExecutionError,
  ExecutionStats,
  EnclaveConfig,
  CreateEnclaveOptions,
  ToolHandler,
  SafeRuntimeContext,
  ExecutionContext,
  SandboxAdapter,
} from './lib/types';

// Safe runtime utilities
export { createSafeRuntime, serializeSafeRuntime } from './lib/safe-runtime';
