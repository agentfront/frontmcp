/**
 * @file table.schema.ts
 * @description Zod schemas for Table and Pagination component options validation.
 *
 * Provides strict validation schemas for table options including columns,
 * sorting, selection, and pagination with HTMX support.
 *
 * @example
 * ```typescript
 * import { TableColumnSchema, TableOptionsSchema } from '@frontmcp/ui';
 *
 * const columnResult = TableColumnSchema.safeParse({
 *   key: 'name',
 *   header: 'Name',
 *   sortable: true,
 * });
 * ```
 *
 * @module @frontmcp/ui/components/table.schema
 */

import { z } from 'zod';

// ============================================
// Column Schema
// ============================================

/**
 * Table column alignment schema
 */
export const TableAlignSchema = z.enum(['left', 'center', 'right']);

/**
 * Table column sort direction schema
 */
export const TableSortDirectionSchema = z.enum(['asc', 'desc']).nullable();

/**
 * Table column definition schema
 * Note: render function cannot be validated by Zod, so we use z.any() for it
 */
export const TableColumnSchema = z
  .object({
    /** Column key (property name) */
    key: z.string(),
    /** Column header text */
    header: z.string(),
    /** Column width (CSS value) */
    width: z.string().optional(),
    /** Text alignment */
    align: TableAlignSchema.optional(),
    /** Sortable column */
    sortable: z.boolean().optional(),
    /** Current sort direction */
    sortDirection: TableSortDirectionSchema.optional(),
    /** Custom cell renderer (function - cannot validate at runtime) */
    render: z.any().optional(),
    /** Additional header CSS classes */
    headerClass: z.string().optional(),
    /** Additional cell CSS classes */
    cellClass: z.string().optional(),
  })
  .strict();

/**
 * Table column type
 */
export type TableColumn = z.infer<typeof TableColumnSchema>;

// ============================================
// HTMX Schemas
// ============================================

/**
 * Sort HTMX options schema
 */
export const TableSortHtmxSchema = z
  .object({
    get: z.string(),
    target: z.string().optional(),
    swap: z.string().optional(),
  })
  .strict()
  .optional();

/**
 * Select HTMX options schema
 */
export const TableSelectHtmxSchema = z
  .object({
    post: z.string(),
    target: z.string().optional(),
  })
  .strict()
  .optional();

// ============================================
// Table Options Schema
// ============================================

/**
 * Complete table options schema
 */
export const TableOptionsSchema = z
  .object({
    /** Column definitions */
    columns: z.array(TableColumnSchema),
    /** Table ID */
    id: z.string().optional(),
    /** Show row selection checkboxes */
    selectable: z.boolean().optional(),
    /** Row hover effect */
    hoverable: z.boolean().optional(),
    /** Striped rows */
    striped: z.boolean().optional(),
    /** Bordered cells */
    bordered: z.boolean().optional(),
    /** Compact size */
    compact: z.boolean().optional(),
    /** Fixed header (sticky) */
    stickyHeader: z.boolean().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** Empty state message */
    emptyMessage: z.string().optional(),
    /** Empty state HTML */
    emptyContent: z.string().optional(),
    /** Loading state */
    loading: z.boolean().optional(),
    /** HTMX for sorting */
    sortHtmx: TableSortHtmxSchema,
    /** HTMX for selection */
    selectHtmx: TableSelectHtmxSchema,
    /** Row key property for selection */
    rowKey: z.string().optional(),
    /** Row click handler (URL template with {key}) */
    onRowClick: z.string().optional(),
  })
  .strict();

/**
 * Table options type (derived from schema)
 */
export type TableOptions = z.infer<typeof TableOptionsSchema>;

// ============================================
// Pagination Schema
// ============================================

/**
 * Pagination HTMX options schema
 */
export const PaginationHtmxSchema = z
  .object({
    get: z.string(),
    target: z.string().optional(),
    swap: z.string().optional(),
  })
  .strict()
  .optional();

/**
 * Pagination options schema
 */
export const PaginationOptionsSchema = z
  .object({
    /** Current page (1-indexed) */
    page: z.number().min(1),
    /** Total pages */
    totalPages: z.number().min(0),
    /** Total items count */
    totalItems: z.number().min(0).optional(),
    /** Items per page */
    pageSize: z.number().min(1).optional(),
    /** Page size options */
    pageSizeOptions: z.array(z.number()).optional(),
    /** Show first/last buttons */
    showFirstLast: z.boolean().optional(),
    /** Show page count */
    showPageCount: z.boolean().optional(),
    /** Show item count */
    showItemCount: z.boolean().optional(),
    /** Show page size selector */
    showPageSize: z.boolean().optional(),
    /** Max visible page buttons */
    maxVisiblePages: z.number().min(1).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** HTMX for page navigation */
    htmx: PaginationHtmxSchema,
  })
  .strict();

/**
 * Pagination options type
 */
export type PaginationOptions = z.infer<typeof PaginationOptionsSchema>;
