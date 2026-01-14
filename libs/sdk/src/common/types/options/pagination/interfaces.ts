// common/types/options/pagination/interfaces.ts
// Explicit TypeScript interfaces for pagination configuration

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
export interface ToolPaginationOptionsInterface {
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
export interface PaginationOptionsInterface {
  /**
   * Tool list pagination settings.
   * When configured, tools/list responses will be paginated with cursor-based navigation.
   */
  tools?: ToolPaginationOptionsInterface;
}
