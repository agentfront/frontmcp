// file: libs/plugins/src/codecall/security/self-reference-guard.ts

import { SelfReferenceError } from '../errors/tool-call.errors';

/**
 * HARDCODED list of CodeCall plugin tool names that MUST be blocked from self-reference.
 *
 * SECURITY: This list is NOT configurable to prevent bypass attempts.
 * Any tool with the 'codecall:' prefix is blocked.
 */
const CODECALL_TOOL_PREFIX = 'codecall:';

/**
 * Explicitly blocked tool names for additional safety.
 * Even if a tool doesn't have the prefix, these are always blocked.
 */
const BLOCKED_CODECALL_TOOLS: ReadonlySet<string> = Object.freeze(
  new Set(['codecall:search', 'codecall:describe', 'codecall:execute', 'codecall:invoke']),
);

/**
 * Check if a tool name is a CodeCall plugin tool that should be blocked.
 *
 * SECURITY: This is the FIRST check in callTool before ANY other processing.
 * It prevents:
 * - Recursive execution attacks (codecall:execute calling itself)
 * - Privilege escalation via nested tool calls
 * - Resource exhaustion through self-invocation loops
 *
 * @param toolName - The name of the tool being called
 * @returns true if the tool is a blocked CodeCall tool
 */
export function isBlockedSelfReference(toolName: string): boolean {
  // Normalize tool name (case-insensitive check for prefix)
  const normalizedName = toolName.toLowerCase().trim();

  // Check for codecall: prefix
  if (normalizedName.startsWith(CODECALL_TOOL_PREFIX)) {
    return true;
  }

  // Check explicit blocklist
  if (BLOCKED_CODECALL_TOOLS.has(toolName)) {
    return true;
  }

  return false;
}

/**
 * Assert that a tool call is not a self-reference.
 * Throws SelfReferenceError if the tool is blocked.
 *
 * SECURITY: This function MUST be called at the very start of callTool,
 * before any other validation or processing.
 *
 * @param toolName - The name of the tool being called
 * @throws SelfReferenceError if the tool is a blocked CodeCall tool
 */
export function assertNotSelfReference(toolName: string): void {
  if (isBlockedSelfReference(toolName)) {
    throw new SelfReferenceError(toolName);
  }
}

/**
 * Get the list of blocked tool patterns for documentation/testing.
 * This is informational only - the actual blocking uses isBlockedSelfReference().
 */
export function getBlockedPatterns(): { prefix: string; explicit: readonly string[] } {
  return {
    prefix: CODECALL_TOOL_PREFIX,
    explicit: Array.from(BLOCKED_CODECALL_TOOLS),
  };
}
