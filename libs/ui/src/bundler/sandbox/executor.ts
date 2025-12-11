/**
 * Secure Code Executor
 *
 * Executes bundled code in a secure sandbox using enclave-vm.
 * Provides defense-in-depth security with:
 * - AST-based validation (81+ blocked attack vectors)
 * - Timeout enforcement (default 5000ms)
 * - Resource limits (maxIterations)
 * - Six security layers
 *
 * @packageDocumentation
 */

// Re-export everything from enclave-adapter
export {
  executeCode,
  executeDefault,
  ExecutionError,
  isExecutionError,
  type ExecutionContext,
  type ExecutionResult,
} from './enclave-adapter';
