// common/types/options/pagination/schema.ts
// Zod schema for pagination configuration

import { z } from 'zod';
import type { RawZodShape } from '../../common.types';
import type { PaginationOptionsInterface, ToolPaginationOptionsInterface } from './interfaces';

/**
 * Zod schema for ToolPaginationOptions.
 */
export const toolPaginationOptionsSchema = z.object({
  mode: z
    .union([z.literal('auto'), z.boolean()])
    .optional()
    .default('auto'),
  pageSize: z.number().int().positive().optional().default(40),
  autoThreshold: z.number().int().positive().optional().default(40),
} satisfies RawZodShape<ToolPaginationOptionsInterface>);

/**
 * Zod schema for PaginationOptions.
 */
export const paginationOptionsSchema = z.object({
  tools: toolPaginationOptionsSchema.optional(),
} satisfies RawZodShape<PaginationOptionsInterface>);

/**
 * Default pagination configuration values.
 */
export const DEFAULT_TOOL_PAGINATION: Required<ToolPaginationOptionsInterface> = {
  mode: 'auto',
  pageSize: 40,
  autoThreshold: 40,
};

/**
 * Tool pagination options type (with defaults applied).
 */
export type ToolPaginationOptions = z.infer<typeof toolPaginationOptionsSchema>;

/**
 * Tool pagination options input type (for user configuration).
 */
export type ToolPaginationOptionsInput = z.input<typeof toolPaginationOptionsSchema>;

/**
 * Pagination options type (with defaults applied).
 */
export type PaginationOptions = z.infer<typeof paginationOptionsSchema>;

/**
 * Pagination options input type (for user configuration).
 */
export type PaginationOptionsInput = z.input<typeof paginationOptionsSchema>;
