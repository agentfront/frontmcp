// file: libs/plugins/src/codecall/utils/build-tool-namespaces.ts

import type { CallToolOptions, ToolCallResult } from '../errors';

/**
 * Identifier pattern matching valid JavaScript identifiers. Used to guard
 * against tool names that would produce illegal property accessors in
 * AgentScript (e.g. `acme.get-user`).
 */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Namespaces that would shadow agentscript globals or commonly-relied-upon
 * intrinsics. Tools whose prefix matches one of these are not surfaced as a
 * namespace; they remain reachable via `callTool('<full-name>', ...)`.
 */
const RESERVED_NAMESPACES: ReadonlySet<string> = new Set([
  'console',
  'Math',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'Symbol',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Date',
  'Error',
  'RegExp',
  'globalThis',
  'global',
  'window',
  'self',
  'undefined',
  'null',
  'true',
  'false',
  'callTool',
  'getTool',
  'mcpLog',
  'mcpNotify',
]);

/**
 * Shape of the bound `callTool` handed to namespaced methods. Mirrors the
 * signature on `CodeCallVmEnvironment.callTool` but in a form independent of
 * call-site generics.
 */
export type NamespacedCallTool = (
  name: string,
  input: unknown,
  options?: CallToolOptions,
) => Promise<unknown | ToolCallResult<unknown>>;

/**
 * Minimal shape needed from a registered tool to drive namespace generation.
 * Accepts either the registry's `ToolEntry` or any object exposing `name`.
 */
export interface NamespaceableTool {
  readonly name: string;
}

/** A single namespace value handed to AgentScript: `{ getUser: (...) => ... }`. */
export type ToolNamespace = Record<string, (input?: unknown, options?: CallToolOptions) => Promise<unknown>>;

/** The full namespace map (e.g. `{ acme: { getUser, listUsers }, billing: { ... } }`). */
export type ToolNamespaces = Record<string, ToolNamespace>;

/**
 * Reasons a tool may be skipped during namespace generation. Returned so the
 * caller can surface diagnostics without re-deriving the rules.
 */
export type NamespaceSkipReason =
  | 'no-namespace-prefix' // tool name has no `.`
  | 'invalid-identifier' // prefix or suffix is not a JS identifier
  | 'reserved-namespace' // prefix shadows a global / intrinsic
  | 'duplicate-method'; // another tool already mapped to the same {ns}.{method}

export interface BuildToolNamespacesResult {
  /** The namespaces object to merge into the VM globals. */
  namespaces: ToolNamespaces;
  /** Tools that were skipped, with the reason. Useful for logs / lint output. */
  skipped: Array<{ name: string; reason: NamespaceSkipReason }>;
}

/**
 * Build a nested namespace object from dotted tool names so AgentScript can
 * call `await acme.getUser({...})` instead of `await callTool('acme.getUser', {...})`.
 *
 * - Tools whose name has no `.` are skipped (still callable via `callTool`).
 * - Tools whose prefix or suffix is not a valid JS identifier are skipped.
 * - Tools whose prefix collides with a reserved global are skipped.
 * - First registration wins on duplicate `{ns}.{method}` (subsequent are reported as skipped).
 *
 * The returned methods are thin wrappers that delegate to `callTool` with the
 * full tool name preserved, so all existing security checks, hooks, quotas,
 * and audit paths run unchanged.
 */
export function buildToolNamespaces(
  tools: ReadonlyArray<NamespaceableTool>,
  callTool: NamespacedCallTool,
): BuildToolNamespacesResult {
  const namespaces: ToolNamespaces = {};
  const skipped: BuildToolNamespacesResult['skipped'] = [];

  for (const tool of tools) {
    const name = tool?.name;
    if (typeof name !== 'string' || name.length === 0) continue;

    const dot = name.indexOf('.');
    if (dot <= 0 || dot === name.length - 1) {
      skipped.push({ name, reason: 'no-namespace-prefix' });
      continue;
    }

    const ns = name.slice(0, dot);
    const method = name.slice(dot + 1);

    if (!IDENT_RE.test(ns) || !IDENT_RE.test(method)) {
      skipped.push({ name, reason: 'invalid-identifier' });
      continue;
    }

    if (RESERVED_NAMESPACES.has(ns)) {
      skipped.push({ name, reason: 'reserved-namespace' });
      continue;
    }

    const bucket = namespaces[ns] ?? (namespaces[ns] = {});
    if (Object.prototype.hasOwnProperty.call(bucket, method)) {
      skipped.push({ name, reason: 'duplicate-method' });
      continue;
    }

    bucket[method] = (input?: unknown, options?: CallToolOptions) => callTool(name, input, options);
  }

  return { namespaces, skipped };
}
