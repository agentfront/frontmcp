/**
 * Table Component
 *
 * Data tables with sorting, selection, and HTMX support.
 */

import { escapeHtml } from '../layouts/base';

// ============================================
// Table Types
// ============================================

/**
 * Table column definition
 */
export interface TableColumn<T = Record<string, unknown>> {
  /** Column key (property name) */
  key: string;
  /** Column header text */
  header: string;
  /** Column width */
  width?: string;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
  /** Sortable column */
  sortable?: boolean;
  /** Current sort direction */
  sortDirection?: 'asc' | 'desc' | null;
  /** Custom cell renderer */
  render?: (value: unknown, row: T, index: number) => string;
  /** Additional header CSS classes */
  headerClass?: string;
  /** Additional cell CSS classes */
  cellClass?: string;
}

/**
 * Table options
 */
export interface TableOptions<T = Record<string, unknown>> {
  /** Column definitions */
  columns: TableColumn<T>[];
  /** Table ID */
  id?: string;
  /** Show row selection checkboxes */
  selectable?: boolean;
  /** Row hover effect */
  hoverable?: boolean;
  /** Striped rows */
  striped?: boolean;
  /** Bordered cells */
  bordered?: boolean;
  /** Compact size */
  compact?: boolean;
  /** Fixed header (sticky) */
  stickyHeader?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Empty state HTML */
  emptyContent?: string;
  /** Loading state */
  loading?: boolean;
  /** HTMX for sorting */
  sortHtmx?: {
    get: string;
    target?: string;
    swap?: string;
  };
  /** HTMX for selection */
  selectHtmx?: {
    post: string;
    target?: string;
  };
  /** Row key property for selection */
  rowKey?: keyof T;
  /** Row click handler (URL template with {key}) */
  onRowClick?: string;
}

// ============================================
// Table Builder
// ============================================

/**
 * Get alignment classes
 */
function getAlignClasses(align: 'left' | 'center' | 'right' = 'left'): string {
  const alignments: Record<string, string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };
  return alignments[align];
}

/**
 * Build sort indicator
 */
function buildSortIndicator(direction: 'asc' | 'desc' | null): string {
  if (direction === 'asc') {
    return `<svg class="w-4 h-4 ml-1 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
    </svg>`;
  }
  if (direction === 'desc') {
    return `<svg class="w-4 h-4 ml-1 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
    </svg>`;
  }
  return `<svg class="w-4 h-4 ml-1 inline-block opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
  </svg>`;
}

/**
 * Build table header
 */
function buildTableHeader<T>(columns: TableColumn<T>[], options: TableOptions<T>): string {
  const { selectable, sortHtmx, compact } = options;
  const paddingClass = compact ? 'px-3 py-2' : 'px-4 py-3';

  const selectAllCell = selectable
    ? `<th class="${paddingClass} w-12">
        <input
          type="checkbox"
          class="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
          aria-label="Select all"
        >
      </th>`
    : '';

  const headerCells = columns
    .map((col) => {
      const alignClass = getAlignClasses(col.align);
      const widthStyle = col.width ? `style="width: ${col.width}"` : '';

      if (col.sortable && sortHtmx) {
        const nextDirection = col.sortDirection === 'asc' ? 'desc' : 'asc';
        const sortUrl = `${sortHtmx.get}${sortHtmx.get.includes('?') ? '&' : '?'}sort=${col.key}&dir=${nextDirection}`;

        return `<th
        class="${paddingClass} ${alignClass} font-semibold text-text-primary cursor-pointer hover:bg-gray-50 ${
          col.headerClass || ''
        }"
        ${widthStyle}
        hx-get="${escapeHtml(sortUrl)}"
        ${sortHtmx.target ? `hx-target="${escapeHtml(sortHtmx.target)}"` : ''}
        ${sortHtmx.swap ? `hx-swap="${escapeHtml(sortHtmx.swap)}"` : ''}
      >
        <span class="inline-flex items-center">
          ${escapeHtml(col.header)}
          ${buildSortIndicator(col.sortDirection || null)}
        </span>
      </th>`;
      }

      return `<th
      class="${paddingClass} ${alignClass} font-semibold text-text-primary ${col.headerClass || ''}"
      ${widthStyle}
    >
      ${escapeHtml(col.header)}
    </th>`;
    })
    .join('\n');

  return `<thead class="bg-gray-50 border-b border-border">
    <tr>
      ${selectAllCell}
      ${headerCells}
    </tr>
  </thead>`;
}

/**
 * Build table body
 */
function buildTableBody<T extends Record<string, unknown>>(
  data: T[],
  columns: TableColumn<T>[],
  options: TableOptions<T>,
): string {
  const {
    selectable,
    hoverable,
    striped,
    bordered,
    compact,
    selectHtmx,
    rowKey = 'id' as keyof T,
    onRowClick,
  } = options;

  const paddingClass = compact ? 'px-3 py-2' : 'px-4 py-3';

  if (data.length === 0) {
    const colspan = columns.length + (selectable ? 1 : 0);
    const emptyContent =
      options.emptyContent ||
      `
      <div class="text-center py-8">
        <svg class="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
        </svg>
        <p class="text-text-secondary">${options.emptyMessage || 'No data available'}</p>
      </div>
    `;

    return `<tbody>
      <tr>
        <td colspan="${colspan}">${emptyContent}</td>
      </tr>
    </tbody>`;
  }

  const rows = data
    .map((row, rowIndex) => {
      const rowId = String(row[rowKey] || rowIndex);
      const rowClasses = [
        hoverable ? 'hover:bg-gray-50' : '',
        striped && rowIndex % 2 === 1 ? 'bg-gray-50/50' : '',
        bordered ? 'border-b border-border' : '',
        onRowClick ? 'cursor-pointer' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const clickHandler = onRowClick
        ? `onclick="window.location.href='${escapeHtml(onRowClick.replace('{key}', rowId))}'"`
        : '';

      const selectCell = selectable
        ? `<td class="${paddingClass}" onclick="event.stopPropagation()">
          <input
            type="checkbox"
            class="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
            name="selected[]"
            value="${escapeHtml(rowId)}"
            ${
              selectHtmx
                ? `
              hx-post="${escapeHtml(selectHtmx.post)}"
              ${selectHtmx.target ? `hx-target="${escapeHtml(selectHtmx.target)}"` : ''}
              hx-trigger="change"
            `
                : ''
            }
            aria-label="Select row"
          >
        </td>`
        : '';

      const cells = columns
        .map((col) => {
          const value = row[col.key];
          const alignClass = getAlignClasses(col.align);
          const cellContent = col.render ? col.render(value, row, rowIndex) : escapeHtml(String(value ?? ''));

          return `<td class="${paddingClass} ${alignClass} ${col.cellClass || ''}">${cellContent}</td>`;
        })
        .join('\n');

      return `<tr class="${rowClasses}" ${clickHandler}>
      ${selectCell}
      ${cells}
    </tr>`;
    })
    .join('\n');

  return `<tbody class="divide-y divide-border">${rows}</tbody>`;
}

/**
 * Build loading overlay
 */
function buildLoadingOverlay(): string {
  return `<div class="absolute inset-0 bg-white/70 flex items-center justify-center">
    <svg class="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  </div>`;
}

/**
 * Build a data table
 */
export function table<T extends Record<string, unknown>>(data: T[], options: TableOptions<T>): string {
  const { id, bordered, stickyHeader, className = '', loading = false } = options;

  const tableClasses = ['w-full', bordered ? 'border border-border' : '', 'text-sm'].filter(Boolean).join(' ');

  const wrapperClasses = ['relative overflow-x-auto', stickyHeader ? 'max-h-96 overflow-y-auto' : '', className]
    .filter(Boolean)
    .join(' ');

  const idAttr = id ? `id="${escapeHtml(id)}"` : '';

  const header = buildTableHeader(options.columns, options);
  const body = buildTableBody(data, options.columns, options);
  const loadingOverlay = loading ? buildLoadingOverlay() : '';

  return `<div class="${wrapperClasses}" ${idAttr}>
    <table class="${tableClasses}">
      ${header}
      ${body}
    </table>
    ${loadingOverlay}
  </div>`;
}

// ============================================
// Pagination Component
// ============================================

/**
 * Pagination options
 */
export interface PaginationOptions {
  /** Current page (1-indexed) */
  page: number;
  /** Total pages */
  totalPages: number;
  /** Total items */
  totalItems?: number;
  /** Items per page */
  pageSize?: number;
  /** Show page size selector */
  showPageSize?: boolean;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Additional CSS classes */
  className?: string;
  /** HTMX for page changes */
  htmx?: {
    get: string;
    target?: string;
    swap?: string;
  };
}

/**
 * Build pagination component
 */
export function pagination(options: PaginationOptions): string {
  const {
    page,
    totalPages,
    totalItems,
    pageSize = 10,
    showPageSize = false,
    pageSizeOptions = [10, 25, 50, 100],
    className = '',
    htmx,
  } = options;

  const buildPageLink = (pageNum: number, label: string, disabled: boolean, active: boolean) => {
    const baseClasses = 'px-3 py-2 text-sm rounded-lg transition-colors';
    const stateClasses = disabled
      ? 'text-gray-300 cursor-not-allowed'
      : active
      ? 'bg-primary text-white'
      : 'text-text-primary hover:bg-gray-100';

    if (disabled) {
      return `<span class="${baseClasses} ${stateClasses}">${label}</span>`;
    }

    const pageUrl = htmx ? `${htmx.get}${htmx.get.includes('?') ? '&' : '?'}page=${pageNum}` : `?page=${pageNum}`;

    const htmxAttrs = htmx
      ? `hx-get="${escapeHtml(pageUrl)}" ${htmx.target ? `hx-target="${escapeHtml(htmx.target)}"` : ''} ${
          htmx.swap ? `hx-swap="${escapeHtml(htmx.swap)}"` : ''
        }`
      : '';

    return `<a href="${escapeHtml(pageUrl)}" class="${baseClasses} ${stateClasses}" ${htmxAttrs}>${label}</a>`;
  };

  // Build page numbers
  const pageNumbers: number[] = [];
  const maxVisible = 5;

  if (totalPages <= maxVisible) {
    for (let i = 1; i <= totalPages; i++) {
      pageNumbers.push(i);
    }
  } else {
    pageNumbers.push(1);

    let start = Math.max(2, page - 1);
    let end = Math.min(totalPages - 1, page + 1);

    if (page <= 2) {
      end = 4;
    } else if (page >= totalPages - 1) {
      start = totalPages - 3;
    }

    if (start > 2) {
      pageNumbers.push(-1); // Ellipsis
    }

    for (let i = start; i <= end; i++) {
      pageNumbers.push(i);
    }

    if (end < totalPages - 1) {
      pageNumbers.push(-1); // Ellipsis
    }

    pageNumbers.push(totalPages);
  }

  const pagesHtml = pageNumbers
    .map((num) => {
      if (num === -1) {
        return '<span class="px-2 py-2 text-text-secondary">...</span>';
      }
      return buildPageLink(num, String(num), false, num === page);
    })
    .join('\n');

  const prevLink = buildPageLink(page - 1, '&larr; Previous', page <= 1, false);
  const nextLink = buildPageLink(page + 1, 'Next &rarr;', page >= totalPages, false);

  const infoHtml =
    totalItems !== undefined
      ? `<span class="text-sm text-text-secondary">
        Showing ${(page - 1) * pageSize + 1} to ${Math.min(page * pageSize, totalItems)} of ${totalItems} results
      </span>`
      : '';

  const pageSizeHtml = showPageSize
    ? `<select
        class="ml-4 px-2 py-1 text-sm border border-border rounded-lg bg-white"
        onchange="window.location.href = '${htmx?.get || ''}?page=1&pageSize=' + this.value"
      >
        ${pageSizeOptions
          .map((size) => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size} per page</option>`)
          .join('')}
      </select>`
    : '';

  return `<div class="flex items-center justify-between ${className}">
    <div class="flex items-center">
      ${infoHtml}
      ${pageSizeHtml}
    </div>
    <div class="flex items-center gap-1">
      ${prevLink}
      ${pagesHtml}
      ${nextLink}
    </div>
  </div>`;
}
