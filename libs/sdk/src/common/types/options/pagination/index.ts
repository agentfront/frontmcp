// common/types/options/pagination/index.ts
// Barrel export for pagination options

export type { ToolPaginationMode, ToolPaginationOptionsInterface, PaginationOptionsInterface } from './interfaces';

export { toolPaginationOptionsSchema, paginationOptionsSchema, DEFAULT_TOOL_PAGINATION } from './schema';

export type {
  ToolPaginationOptions,
  ToolPaginationOptionsInput,
  PaginationOptions,
  PaginationOptionsInput,
} from './schema';
