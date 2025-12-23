// file: libs/browser/src/components/layout/Grid.tsx
/**
 * Grid Layout Component
 *
 * A CSS Grid-based layout component with configurable columns,
 * gaps, and responsive props.
 */

import React, { forwardRef, useMemo } from 'react';
import type { CSSProperties, ElementType, ReactNode, Ref } from 'react';
import { type Alignment, type ResponsiveValue, type SpacingValue, ALIGN_MAP, spacingToPx } from './types';

/**
 * Grid component props
 */
export interface GridProps {
  /** Children to render */
  children?: ReactNode;
  /** Number of columns (or template string) */
  columns?: ResponsiveValue<number | string>;
  /** Number of rows (or template string) */
  rows?: ResponsiveValue<number | string>;
  /** Gap between items (spacing scale value) */
  gap?: ResponsiveValue<SpacingValue>;
  /** Column gap (overrides gap for columns) */
  columnGap?: ResponsiveValue<SpacingValue>;
  /** Row gap (overrides gap for rows) */
  rowGap?: ResponsiveValue<SpacingValue>;
  /** Align items (cross-axis) */
  align?: ResponsiveValue<Alignment>;
  /** Justify items (main-axis) */
  justify?: ResponsiveValue<Alignment>;
  /** Whether to use inline-grid */
  inline?: boolean;
  /** Auto-fit columns with minmax */
  autoFit?: boolean;
  /** Minimum column width for auto-fit */
  minColumnWidth?: ResponsiveValue<number | string>;
  /** Custom CSS class */
  className?: string;
  /** Inline styles */
  style?: CSSProperties;
  /** HTML element to render as */
  as?: ElementType;
  /** Test ID for testing */
  testId?: string;
  /** Full width */
  fullWidth?: boolean;
  /** Full height */
  fullHeight?: boolean;
  /** Padding (spacing scale value) */
  padding?: ResponsiveValue<SpacingValue>;
}

/**
 * Grid Item component props
 */
export interface GridItemProps {
  /** Children to render */
  children?: ReactNode;
  /** Column span */
  colSpan?: ResponsiveValue<number | 'full'>;
  /** Row span */
  rowSpan?: ResponsiveValue<number>;
  /** Column start */
  colStart?: ResponsiveValue<number>;
  /** Column end */
  colEnd?: ResponsiveValue<number>;
  /** Row start */
  rowStart?: ResponsiveValue<number>;
  /** Row end */
  rowEnd?: ResponsiveValue<number>;
  /** Custom CSS class */
  className?: string;
  /** Inline styles */
  style?: CSSProperties;
  /** HTML element to render as */
  as?: ElementType;
  /** Test ID for testing */
  testId?: string;
}

/**
 * Grid - A CSS Grid layout component
 *
 * @example Basic 3-column grid
 * ```tsx
 * <Grid columns={3} gap={4}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 *   <div>Item 4</div>
 * </Grid>
 * ```
 *
 * @example Responsive grid
 * ```tsx
 * <Grid columns={{ xs: 1, sm: 2, lg: 4 }} gap={4}>
 *   {items.map(item => <Card key={item.id} {...item} />)}
 * </Grid>
 * ```
 *
 * @example Auto-fit grid
 * ```tsx
 * <Grid autoFit minColumnWidth={250} gap={4}>
 *   {items.map(item => <Card key={item.id} {...item} />)}
 * </Grid>
 * ```
 */
export const Grid = forwardRef(function Grid(
  {
    children,
    columns = 1,
    rows,
    gap = 0,
    columnGap,
    rowGap,
    align,
    justify,
    inline = false,
    autoFit = false,
    minColumnWidth = 250,
    className = '',
    style,
    as: Component = 'div',
    testId,
    fullWidth = false,
    fullHeight = false,
    padding,
  }: GridProps,
  ref: Ref<HTMLElement>,
) {
  const computedStyle = useMemo((): CSSProperties => {
    const baseStyle: CSSProperties = {
      display: inline ? 'inline-grid' : 'grid',
    };

    // Columns
    if (autoFit) {
      const minWidth =
        typeof minColumnWidth === 'number'
          ? `${minColumnWidth}px`
          : typeof minColumnWidth === 'object'
          ? `${Object.values(minColumnWidth)[0]}px`
          : minColumnWidth;
      baseStyle.gridTemplateColumns = `repeat(auto-fit, minmax(${minWidth}, 1fr))`;
    } else if (typeof columns === 'number') {
      baseStyle.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    } else if (typeof columns === 'string') {
      baseStyle.gridTemplateColumns = columns;
    } else {
      const firstCols = Object.values(columns)[0];
      if (typeof firstCols === 'number') {
        baseStyle.gridTemplateColumns = `repeat(${firstCols}, 1fr)`;
      } else {
        baseStyle.gridTemplateColumns = firstCols as string;
      }
    }

    // Rows
    if (rows !== undefined) {
      if (typeof rows === 'number') {
        baseStyle.gridTemplateRows = `repeat(${rows}, 1fr)`;
      } else if (typeof rows === 'string') {
        baseStyle.gridTemplateRows = rows;
      } else {
        const firstRows = Object.values(rows)[0];
        if (typeof firstRows === 'number') {
          baseStyle.gridTemplateRows = `repeat(${firstRows}, 1fr)`;
        } else {
          baseStyle.gridTemplateRows = firstRows as string;
        }
      }
    }

    // Gap
    const resolveGap = (g: ResponsiveValue<SpacingValue> | undefined): string | undefined => {
      if (g === undefined) return undefined;
      if (typeof g === 'number') return `${spacingToPx(g)}px`;
      const first = Object.values(g)[0] as SpacingValue;
      return `${spacingToPx(first)}px`;
    };

    const gapValue = resolveGap(gap);
    const colGapValue = resolveGap(columnGap);
    const rowGapValue = resolveGap(rowGap);

    if (gapValue) {
      baseStyle.gap = gapValue;
    }
    if (colGapValue) {
      baseStyle.columnGap = colGapValue;
    }
    if (rowGapValue) {
      baseStyle.rowGap = rowGapValue;
    }

    // Alignment
    if (align !== undefined) {
      const alignValue = typeof align === 'string' ? align : (Object.values(align)[0] as Alignment);
      baseStyle.alignItems = ALIGN_MAP[alignValue];
    }

    if (justify !== undefined) {
      const justifyValue = typeof justify === 'string' ? justify : (Object.values(justify)[0] as Alignment);
      baseStyle.justifyItems = ALIGN_MAP[justifyValue];
    }

    // Dimensions
    if (fullWidth) {
      baseStyle.width = '100%';
    }
    if (fullHeight) {
      baseStyle.height = '100%';
    }

    // Padding
    if (padding !== undefined) {
      const p = typeof padding === 'number' ? padding : (Object.values(padding)[0] as SpacingValue);
      baseStyle.padding = `${spacingToPx(p)}px`;
    }

    return { ...baseStyle, ...style };
  }, [
    columns,
    rows,
    gap,
    columnGap,
    rowGap,
    align,
    justify,
    inline,
    autoFit,
    minColumnWidth,
    fullWidth,
    fullHeight,
    padding,
    style,
  ]);

  return (
    <Component ref={ref} className={`frontmcp-grid ${className}`.trim()} style={computedStyle} data-testid={testId}>
      {children}
    </Component>
  );
}) as <C extends ElementType = 'div'>(
  props: GridProps & { as?: C; ref?: Ref<HTMLElement> },
) => React.ReactElement | null;

/**
 * Grid.Item - A grid item with span/placement props
 *
 * @example Span multiple columns
 * ```tsx
 * <Grid columns={4} gap={4}>
 *   <Grid.Item colSpan={2}>Wide item</Grid.Item>
 *   <Grid.Item>Normal</Grid.Item>
 *   <Grid.Item>Normal</Grid.Item>
 * </Grid>
 * ```
 */
export const GridItem = forwardRef(function GridItem(
  {
    children,
    colSpan,
    rowSpan,
    colStart,
    colEnd,
    rowStart,
    rowEnd,
    className = '',
    style,
    as: Component = 'div',
    testId,
  }: GridItemProps,
  ref: Ref<HTMLElement>,
) {
  const computedStyle = useMemo((): CSSProperties => {
    const baseStyle: CSSProperties = {};

    // Column span
    if (colSpan !== undefined) {
      const span = typeof colSpan === 'object' ? Object.values(colSpan)[0] : colSpan;
      if (span === 'full') {
        baseStyle.gridColumn = '1 / -1';
      } else {
        baseStyle.gridColumn = `span ${span}`;
      }
    }

    // Row span
    if (rowSpan !== undefined) {
      const span = typeof rowSpan === 'object' ? Object.values(rowSpan)[0] : rowSpan;
      baseStyle.gridRow = `span ${span}`;
    }

    // Column start/end
    if (colStart !== undefined) {
      const start = typeof colStart === 'object' ? Object.values(colStart)[0] : colStart;
      baseStyle.gridColumnStart = start;
    }
    if (colEnd !== undefined) {
      const end = typeof colEnd === 'object' ? Object.values(colEnd)[0] : colEnd;
      baseStyle.gridColumnEnd = end;
    }

    // Row start/end
    if (rowStart !== undefined) {
      const start = typeof rowStart === 'object' ? Object.values(rowStart)[0] : rowStart;
      baseStyle.gridRowStart = start;
    }
    if (rowEnd !== undefined) {
      const end = typeof rowEnd === 'object' ? Object.values(rowEnd)[0] : rowEnd;
      baseStyle.gridRowEnd = end;
    }

    return { ...baseStyle, ...style };
  }, [colSpan, rowSpan, colStart, colEnd, rowStart, rowEnd, style]);

  return (
    <Component
      ref={ref}
      className={`frontmcp-grid-item ${className}`.trim()}
      style={computedStyle}
      data-testid={testId}
    >
      {children}
    </Component>
  );
}) as <C extends ElementType = 'div'>(
  props: GridItemProps & { as?: C; ref?: Ref<HTMLElement> },
) => React.ReactElement | null;

// Attach Item to Grid for convenience
(Grid as typeof Grid & { Item: typeof GridItem }).Item = GridItem;
