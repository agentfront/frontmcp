/**
 * @file esm-normalize.utils.ts
 * @description Utilities to normalize raw ESM module exports into typed definitions
 * usable by the ESM instance factories.
 *
 * Handles plain object exports with execute/read functions.
 * Decorated classes (@Tool/@Resource/@Prompt) are detected separately via
 * `isDecoratedToolClass` etc. and handled by the standard normalization path
 * in AppEsmInstance (full DI support).
 */

import { getMetadata, isClass } from '@frontmcp/di';
import {
  FrontMcpToolTokens,
  FrontMcpResourceTokens,
  FrontMcpPromptTokens,
  FrontMcpLocalAppTokens,
  FrontMcpSkillTokens,
  FrontMcpJobTokens,
} from '../../common/tokens';
import type { EsmToolDefinition, EsmResourceDefinition, EsmPromptDefinition } from '../../esm-loader/factories';

// ═══════════════════════════════════════════════════════════════════
// DECORATED CLASS DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if a raw ESM export is a class decorated with @App.
 * Detects standard FrontMCP @App-decorated classes loaded from npm packages.
 */
export function isDecoratedAppClass(raw: unknown): boolean {
  return isClass(raw) && getMetadata(FrontMcpLocalAppTokens.type, raw) === true;
}

/**
 * Check if a raw ESM export is a class decorated with @Tool.
 * Uses the actual Symbol tokens from FrontMcpToolTokens (not string keys).
 */
export function isDecoratedToolClass(raw: unknown): boolean {
  return isClass(raw) && getMetadata(FrontMcpToolTokens.type, raw) === true;
}

/**
 * Check if a raw ESM export is a class decorated with @Resource.
 */
export function isDecoratedResourceClass(raw: unknown): boolean {
  return isClass(raw) && getMetadata(FrontMcpResourceTokens.type, raw) === true;
}

/**
 * Check if a raw ESM export is a class decorated with @Prompt.
 */
export function isDecoratedPromptClass(raw: unknown): boolean {
  return isClass(raw) && getMetadata(FrontMcpPromptTokens.type, raw) === true;
}

/**
 * Check if a raw ESM export is a class decorated with @Skill.
 */
export function isDecoratedSkillClass(raw: unknown): boolean {
  return isClass(raw) && getMetadata(FrontMcpSkillTokens.type, raw) === true;
}

/**
 * Check if a raw ESM export is a class decorated with @Job.
 */
export function isDecoratedJobClass(raw: unknown): boolean {
  return isClass(raw) && getMetadata(FrontMcpJobTokens.type, raw) === true;
}

// ═══════════════════════════════════════════════════════════════════
// PLAIN OBJECT NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize a raw tool export from an ESM module into an EsmToolDefinition.
 *
 * Only handles plain objects: { name, description?, inputSchema?, execute }.
 * Decorated classes are detected by `isDecoratedToolClass()` and handled
 * through the standard `normalizeTool()` path in AppEsmInstance.
 *
 * @returns Normalized tool definition, or undefined if the export is not a valid plain-object tool
 */
export function normalizeToolFromEsmExport(raw: unknown): EsmToolDefinition | undefined {
  if (!raw || typeof raw !== 'object' || isClass(raw)) return undefined;

  const obj = raw as Record<string, unknown>;
  if (typeof obj['execute'] === 'function' && typeof obj['name'] === 'string') {
    return {
      name: obj['name'] as string,
      description: obj['description'] as string | undefined,
      inputSchema: obj['inputSchema'] as Record<string, unknown> | undefined,
      outputSchema: obj['outputSchema'],
      execute: obj['execute'] as EsmToolDefinition['execute'],
    };
  }

  return undefined;
}

/**
 * Normalize a raw resource export from an ESM module into an EsmResourceDefinition.
 *
 * Only handles plain objects: { name, description?, uri, mimeType?, read }.
 * Decorated classes are detected by `isDecoratedResourceClass()` and handled
 * through the standard `normalizeResource()` path in AppEsmInstance.
 */
export function normalizeResourceFromEsmExport(raw: unknown): EsmResourceDefinition | undefined {
  if (!raw || typeof raw !== 'object' || isClass(raw)) return undefined;

  const obj = raw as Record<string, unknown>;
  if (typeof obj['read'] === 'function' && typeof obj['name'] === 'string' && typeof obj['uri'] === 'string') {
    return {
      name: obj['name'] as string,
      description: obj['description'] as string | undefined,
      uri: obj['uri'] as string,
      mimeType: obj['mimeType'] as string | undefined,
      read: obj['read'] as EsmResourceDefinition['read'],
    };
  }

  return undefined;
}

/**
 * Normalize a raw prompt export from an ESM module into an EsmPromptDefinition.
 *
 * Only handles plain objects: { name, description?, arguments?, execute }.
 * Decorated classes are detected by `isDecoratedPromptClass()` and handled
 * through the standard `normalizePrompt()` path in AppEsmInstance.
 */
export function normalizePromptFromEsmExport(raw: unknown): EsmPromptDefinition | undefined {
  if (!raw || typeof raw !== 'object' || isClass(raw)) return undefined;

  const obj = raw as Record<string, unknown>;
  if (typeof obj['execute'] === 'function' && typeof obj['name'] === 'string') {
    return {
      name: obj['name'] as string,
      description: obj['description'] as string | undefined,
      arguments: obj['arguments'] as EsmPromptDefinition['arguments'],
      execute: obj['execute'] as EsmPromptDefinition['execute'],
    };
  }

  return undefined;
}
