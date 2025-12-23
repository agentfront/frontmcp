// file: libs/browser/src/components/layout/Stack.tsx
/**
 * Stack Layout Component
 *
 * A flexbox-based vertical or horizontal stack layout with configurable
 * spacing, alignment, and responsive props.
 */

import React, { forwardRef, useMemo } from 'react';
import type { CSSProperties, ElementType, ReactNode, Ref } from 'react';
import {
  type Alignment,
  type Justification,
  type ResponsiveValue,
  type SpacingValue,
  ALIGN_MAP,
  JUSTIFY_MAP,
  spacingToPx,
} from './types';

/**
 * Stack direction
 */
export type StackDirection = 'vertical' | 'horizontal' | 'vertical-reverse' | 'horizontal-reverse';

/**
 * Stack component props
 */
export interface StackProps {
  /** Children to render */
  children?: ReactNode;
  /** Stack direction */
  direction?: ResponsiveValue<StackDirection>;
  /** Gap between items (spacing scale value) */
  gap?: ResponsiveValue<SpacingValue>;
  /** Cross-axis alignment */
  align?: ResponsiveValue<Alignment>;
  /** Main-axis justification */
  justify?: ResponsiveValue<Justification>;
  /** Whether to wrap items */
  wrap?: ResponsiveValue<boolean>;
  /** Whether to use inline-flex */
  inline?: boolean;
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
  /** Padding X (horizontal) */
  paddingX?: ResponsiveValue<SpacingValue>;
  /** Padding Y (vertical) */
  paddingY?: ResponsiveValue<SpacingValue>;
}

/**
 * Direction to flex-direction mapping
 */
const DIRECTION_MAP: Record<StackDirection, string> = {
  vertical: 'column',
  horizontal: 'row',
  'vertical-reverse': 'column-reverse',
  'horizontal-reverse': 'row-reverse',
};

/**
 * Stack - A flexible stack layout component
 *
 * @example Vertical stack with gap
 * ```tsx
 * <Stack gap={4}>
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 * </Stack>
 * ```
 *
 * @example Horizontal stack with alignment
 * ```tsx
 * <Stack direction="horizontal" align="center" justify="between">
 *   <Logo />
 *   <Nav />
 *   <UserMenu />
 * </Stack>
 * ```
 *
 * @example Responsive stack
 * ```tsx
 * <Stack
 *   direction={{ xs: 'vertical', md: 'horizontal' }}
 *   gap={{ xs: 2, md: 4 }}
 * >
 *   <Sidebar />
 *   <Content />
 * </Stack>
 * ```
 */
export const Stack = forwardRef(function Stack(
  {
    children,
    direction = 'vertical',
    gap = 0,
    align = 'stretch',
    justify = 'start',
    wrap = false,
    inline = false,
    className = '',
    style,
    as: Component = 'div',
    testId,
    fullWidth = false,
    fullHeight = false,
    padding,
    paddingX,
    paddingY,
  }: StackProps,
  ref: Ref<HTMLElement>,
) {
  const computedStyle = useMemo((): CSSProperties => {
    const baseStyle: CSSProperties = {
      display: inline ? 'inline-flex' : 'flex',
    };

    // Direction
    if (typeof direction === 'string') {
      baseStyle.flexDirection = DIRECTION_MAP[direction] as CSSProperties['flexDirection'];
    } else {
      // Use first defined breakpoint for SSR, CSS will handle responsive
      const firstDir = Object.values(direction)[0] as StackDirection;
      baseStyle.flexDirection = DIRECTION_MAP[firstDir] as CSSProperties['flexDirection'];
    }

    // Gap
    if (typeof gap === 'number') {
      baseStyle.gap = `${spacingToPx(gap)}px`;
    } else {
      const firstGap = Object.values(gap)[0] as SpacingValue;
      baseStyle.gap = `${spacingToPx(firstGap)}px`;
    }

    // Alignment
    if (typeof align === 'string') {
      baseStyle.alignItems = ALIGN_MAP[align];
    } else {
      const firstAlign = Object.values(align)[0] as Alignment;
      baseStyle.alignItems = ALIGN_MAP[firstAlign];
    }

    // Justification
    if (typeof justify === 'string') {
      baseStyle.justifyContent = JUSTIFY_MAP[justify];
    } else {
      const firstJustify = Object.values(justify)[0] as Justification;
      baseStyle.justifyContent = JUSTIFY_MAP[firstJustify];
    }

    // Wrap
    if (typeof wrap === 'boolean') {
      baseStyle.flexWrap = wrap ? 'wrap' : 'nowrap';
    } else {
      const firstWrap = Object.values(wrap)[0] as boolean;
      baseStyle.flexWrap = firstWrap ? 'wrap' : 'nowrap';
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
    if (paddingX !== undefined) {
      const px = typeof paddingX === 'number' ? paddingX : (Object.values(paddingX)[0] as SpacingValue);
      baseStyle.paddingLeft = `${spacingToPx(px)}px`;
      baseStyle.paddingRight = `${spacingToPx(px)}px`;
    }
    if (paddingY !== undefined) {
      const py = typeof paddingY === 'number' ? paddingY : (Object.values(paddingY)[0] as SpacingValue);
      baseStyle.paddingTop = `${spacingToPx(py)}px`;
      baseStyle.paddingBottom = `${spacingToPx(py)}px`;
    }

    return { ...baseStyle, ...style };
  }, [direction, gap, align, justify, wrap, inline, fullWidth, fullHeight, padding, paddingX, paddingY, style]);

  return (
    <Component ref={ref} className={`frontmcp-stack ${className}`.trim()} style={computedStyle} data-testid={testId}>
      {children}
    </Component>
  );
}) as <C extends ElementType = 'div'>(
  props: StackProps & { as?: C; ref?: Ref<HTMLElement> },
) => React.ReactElement | null;
