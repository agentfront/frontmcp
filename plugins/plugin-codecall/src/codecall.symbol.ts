// file: libs/plugins/src/codecall/codecall.symbol.ts

import { type CodeCallVmPreset } from './codecall.types';
import type { CallToolOptions, ToolCallResult } from './errors';

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
 * A tool's public description as handed to sandboxed scripts. Schemas are plain JSON Schema
 * documents, never the registry's declared schema objects, and are `null` when the tool has
 * no schema to advertise.
 */
export interface CodeCallToolDescription {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
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
   *                               The sandbox calls it without options: it applies a script's
   *                               `{ throwOnError: false }` itself, for `callTool()` and
   *                               namespace methods alike, so it needs the throw.
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

  /**
   * Look up a tool's public description.
   *
   * Returns `undefined` when the tool is unknown, is a CodeCall meta-tool, falls outside the
   * script's `allowedTools` whitelist, or when its schemas have no plain JSON form (a circular
   * schema, for example) — callers cannot distinguish "not visible" from "not projectable".
   */
  getTool: (name: string) => CodeCallToolDescription | undefined;

  console?: Console;

  mcpLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => void;

  mcpNotify?: (event: string, payload: Record<string, unknown>) => void;

  /**
   * Optional dotted-tool-name namespaces, as data: `{ acme: { getUser: 'acme.getUser' } }`.
   *
   * The enclave service hands them to the sandbox as its `toolNamespaces`, which builds the
   * objects itself, so AgentScript can call `await acme.getUser({...})` and every such call is a
   * `callTool('acme.getUser', …)` inside the sandbox: it passes the tool-call cap, rate limit
   * and suspicious-sequence checks (they are never host functions). Tools whose names the
   * sandbox can't bind remain reachable only via `callTool`.
   */
  toolNamespaces?: Record<string, Record<string, string>>;
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
  /** The caller's surface (`availableWhen.surface`): tools not offered on it are left out. */
  surface?: string;
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
   * Check if a tool exists in the index (for a caller on `surface`, when given)
   */
  hasTool(toolName: string, surface?: string): boolean;

  /**
   * Get the total number of indexed tools (that a caller on `surface` may reach, when given)
   */
  getTotalCount(surface?: string): number;

  /**
   * Initialize the search index with tools
   */
  initialize(): Promise<void>;
}
