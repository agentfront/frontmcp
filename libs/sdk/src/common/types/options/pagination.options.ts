import { z } from 'zod';

/**
 * Tool pagination mode.
 * - 'auto': Enable pagination when tool count exceeds threshold (default)
 * - true: Always enable pagination
 * - false: Disable pagination entirely
 */
export type ToolPaginationMode = 'auto' | boolean;

/**
 * Configuration options for tool list pagination.
 */
export interface ToolPaginationOptions {
  /**
   * Pagination mode.
   * - 'auto': Paginate when tools exceed `autoThreshold` (default)
   * - true: Always paginate
   * - false: Never paginate
   * @default 'auto'
   */
  mode?: ToolPaginationMode;

  /**
   * Number of tools per page.
   * @default 40
   */
  pageSize?: number;

  /**
   * Threshold for auto-pagination mode.
   * When `mode` is 'auto', pagination activates if tool count exceeds this value.
   * @default 40
   */
  autoThreshold?: number;
}

/**
 * Pagination configuration for list operations.
 * Currently only tool list pagination is supported.
 */
export interface PaginationOptions {
  /**
   * Tool list pagination settings.
   * When configured, tools/list responses will be paginated with cursor-based navigation.
   */
  tools?: ToolPaginationOptions;
}

// Zod schema for ToolPaginationOptions
export const toolPaginationOptionsSchema = z.object({
  mode: z
    .union([z.literal('auto'), z.boolean()])
    .optional()
    .default('auto'),
  pageSize: z.number().int().positive().optional().default(40),
  autoThreshold: z.number().int().positive().optional().default(40),
});

// Zod schema for PaginationOptions
export const paginationOptionsSchema = z.object({
  tools: toolPaginationOptionsSchema.optional(),
});

/**
 * Default pagination configuration values.
 */
export const DEFAULT_TOOL_PAGINATION: Required<ToolPaginationOptions> = {
  mode: 'auto',
  pageSize: 40,
  autoThreshold: 40,
};
