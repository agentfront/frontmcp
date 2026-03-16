/**
 * @file app-filter.metadata.ts
 * @description Include/exclude filtering for tools, resources, prompts, and other primitives
 * loaded from remote or ESM-based apps.
 */

import { z } from 'zod';

/**
 * Glob-style name patterns per primitive type.
 * Each key maps to an array of name patterns (supports `*` wildcards).
 *
 * @example
 * ```ts
 * { tools: ['echo', 'add'], resources: ['config:*'] }
 * ```
 */
export interface PrimitiveFilterMap {
  tools?: string[];
  resources?: string[];
  prompts?: string[];
  agents?: string[];
  skills?: string[];
  jobs?: string[];
  workflows?: string[];
}

/**
 * Keys that can appear in a PrimitiveFilterMap.
 */
export const PRIMITIVE_FILTER_KEYS = [
  'tools',
  'resources',
  'prompts',
  'agents',
  'skills',
  'jobs',
  'workflows',
] as const;

export type PrimitiveFilterKey = (typeof PRIMITIVE_FILTER_KEYS)[number];

/**
 * Configuration for include/exclude filtering of primitives from external apps.
 *
 * @example
 * ```ts
 * // Include everything, exclude specific tools
 * { default: 'include', exclude: { tools: ['dangerous-*'] } }
 *
 * // Exclude everything, include only specific tools
 * { default: 'exclude', include: { tools: ['echo', 'add'] } }
 * ```
 */
export interface AppFilterConfig {
  /**
   * Default behavior for primitives not explicitly listed.
   * - `'include'` (default): everything is included unless in `exclude`
   * - `'exclude'`: everything is excluded unless in `include`
   */
  default?: 'include' | 'exclude';

  /** Include specific primitives by type and name glob pattern */
  include?: PrimitiveFilterMap;

  /** Exclude specific primitives by type and name glob pattern */
  exclude?: PrimitiveFilterMap;
}

// ═══════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════

const primitiveFilterMapSchema = z.object({
  tools: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
  prompts: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  jobs: z.array(z.string()).optional(),
  workflows: z.array(z.string()).optional(),
});

export const appFilterConfigSchema = z.object({
  default: z.enum(['include', 'exclude']).optional(),
  include: primitiveFilterMapSchema.optional(),
  exclude: primitiveFilterMapSchema.optional(),
});
