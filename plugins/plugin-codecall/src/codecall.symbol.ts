// file: libs/plugins/src/codecall/codecall.symbol.ts

import { CodeCallVmPreset } from './codecall.types';
import type { ToolCallResult, CallToolOptions } from './errors';

export interface CodeCallAstValidationIssue {
  kind: 'IllegalBuiltinAccess' | 'DisallowedGlobal' | 'DisallowedLoop' | 'ParseError';
  message: string;
  location?: { line: number; column: number };
  identifier?: string;
}

export interface CodeCallAstValidationResult {
  ok: boolean;
  issues: CodeCallAstValidationIssue[];
  transformedCode?: string;
}

/**
 * Interface for the AST validator service
 */
export interface CodeCallAstValidator {
  /**
   * Validate a JavaScript script before execution
   */
  validate(script: string): Promise<CodeCallAstValidationResult>;
}

/**
 * Resolved VM options with all defaults applied.
 * Plugins compute this once and pass into providers.
 */
export interface ResolvedCodeCallVmOptions {
  preset: CodeCallVmPreset;
  timeoutMs: number;
  allowLoops: boolean;
  maxSteps?: number;
  disabledBuiltins: string[];
  disabledGlobals: string[];
  allowConsole: boolean;
  maxSanitizeDepth: number;
  maxSanitizeProperties: number;
}

/**
 * Environment available to code running inside the VM.
 * The plugin is responsible for wiring this to the underlying tool pipeline.
 */
export interface CodeCallVmEnvironment {
  /**
   * Call a tool from within AgentScript.
   *
   * @param name - Tool name (e.g., 'users:list')
   * @param input - Tool input arguments
   * @param options - Optional behavior configuration
   * @param options.throwOnError - When true (default), throws on error.
   *                               When false, returns { success, data, error }.
   *
   * SECURITY NOTES:
   * - Cannot call 'codecall:*' tools (self-reference blocked)
   * - Errors are sanitized - no stack traces or internal details exposed
   * - Security guard errors (self-reference, access control) are NEVER catchable
   */
  callTool: <TInput, TResult>(
    name: string,
    input: TInput,
    options?: CallToolOptions,
  ) => Promise<TResult | ToolCallResult<TResult>>;

  getTool: (name: string) =>
    | {
        name: string;
        description?: string;
        inputSchema: unknown;
        outputSchema?: unknown | null;
      }
    | undefined;

  console?: Console;

  mcpLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => void;

  mcpNotify?: (event: string, payload: Record<string, unknown>) => void;
}

/**
 * Result from a tool search query
 */
export interface ToolSearchResult {
  toolName: string;
  appId?: string;
  description: string;
  relevanceScore: number;
}

/**
 * Options for searching tools
 */
export interface ToolSearchOptions {
  topK?: number;
  appIds?: string[];
  excludeToolNames?: string[];
}

/**
 * Interface for the tool search service
 */
export interface ToolSearch {
  /**
   * Search for tools matching the query
   */
  search(query: string, options?: ToolSearchOptions): Promise<ToolSearchResult[]>;

  /**
   * Check if a tool exists in the index
   */
  hasTool(toolName: string): boolean;

  /**
   * Get the total number of indexed tools
   */
  getTotalCount(): number;

  /**
   * Initialize the search index with tools
   */
  initialize(): Promise<void>;
}
