// file: libs/sdk/src/common/flow/flow.utils.ts
// Shared utilities for list flows (tools/list, resources/list, etc.)

import { z, ZodType } from 'zod';
import { InvalidInputError, InvalidMethodError } from '../../errors';

/**
 * Parse list request input and validate method.
 * Common pattern used in tools/list, resources/list, etc.
 *
 * @param rawInput - Raw input from the flow
 * @param schema - Zod schema for the input
 * @param expectedMethod - Expected MCP method (e.g., 'tools/list', 'resources/list')
 * @returns Parsed params including cursor
 */
export function parseListInput<T extends ZodType>(
  rawInput: unknown,
  schema: T,
  expectedMethod: string,
): { cursor?: string; params: z.infer<T>['request']['params'] } {
  let method: string;
  let params: z.infer<T>['request']['params'];

  try {
    const inputData = schema.parse(rawInput);
    method = inputData.request.method;
    params = inputData.request.params;
  } catch (e) {
    throw new InvalidInputError('Invalid request format', e instanceof z.ZodError ? e.errors : undefined);
  }

  if (method !== expectedMethod) {
    throw new InvalidMethodError(method, expectedMethod);
  }

  return {
    cursor: params?.cursor,
    params,
  };
}

/**
 * Entry with owner information for conflict resolution
 */
export interface OwnedEntry<T> {
  ownerName: string;
  entry: T;
}

/**
 * Resolved entry with final name after conflict resolution
 */
export interface ResolvedEntry<T> extends OwnedEntry<T> {
  finalName: string;
}

/**
 * Resolve name conflicts by prefixing with owner name.
 * Used for tools, resources, prompts, etc.
 *
 * @param entries - Array of entries with owner names
 * @param getBaseName - Function to extract base name from entry
 * @returns Resolved entries with final names
 */
export function resolveNameConflicts<T>(
  entries: OwnedEntry<T>[],
  getBaseName: (entry: T) => string,
): ResolvedEntry<T>[] {
  // Count occurrences of each base name
  const counts = new Map<string, number>();
  for (const { entry } of entries) {
    const baseName = getBaseName(entry);
    counts.set(baseName, (counts.get(baseName) ?? 0) + 1);
  }

  // Find which names have conflicts (appear more than once)
  const conflicts = new Set<string>([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));

  // Resolve by prefixing conflicting names with owner
  return entries.map(({ ownerName, entry }) => {
    const baseName = getBaseName(entry);
    const finalName = conflicts.has(baseName) ? `${ownerName}:${baseName}` : baseName;
    return { ownerName, entry, finalName };
  });
}

/**
 * Get a preview of items for logging (first N items).
 *
 * @param items - Array of items
 * @param getName - Function to extract display name from item
 * @param n - Number of items to preview (default: 5)
 * @returns Formatted preview string
 */
export function previewItems<T>(items: T[], getName: (item: T) => string, n = 5): string {
  const names = items.slice(0, n).map(getName);
  const preview = names.join(', ');
  const extra = items.length > n ? `, +${items.length - n} more` : '';
  return `${preview}${extra}`;
}

/**
 * Get the count of conflicts from entries.
 *
 * @param entries - Array of entries
 * @param getBaseName - Function to extract base name from entry
 * @returns Object with conflict count and conflict names
 */
export function detectConflicts<T>(
  entries: T[],
  getBaseName: (entry: T) => string,
): { count: number; names: string[] } {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const baseName = getBaseName(entry);
    counts.set(baseName, (counts.get(baseName) ?? 0) + 1);
  }

  const conflictNames = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  return {
    count: conflictNames.length,
    names: conflictNames,
  };
}
