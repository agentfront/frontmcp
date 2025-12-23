// file: libs/browser/src/components/layout/types.ts
/**
 * Layout Component Types
 *
 * Shared type definitions for layout components.
 */

import type { CSSProperties, ReactNode, ElementType } from 'react';

/**
 * Responsive breakpoints
 */
export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/**
 * Breakpoint values in pixels
 */
export const BREAKPOINTS: Record<Breakpoint, number> = {
  xs: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

/**
 * Spacing scale (based on 4px unit)
 */
export type SpacingValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 56 | 64;

/**
 * Convert spacing value to pixels
 */
export function spacingToPx(value: SpacingValue): number {
  return value * 4;
}

/**
 * Responsive value - can be a single value or an object with breakpoint keys
 */
export type ResponsiveValue<T> = T | Partial<Record<Breakpoint, T>>;

/**
 * Common layout props
 */
export interface LayoutBaseProps {
  /** Children to render */
  children?: ReactNode;
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
 * Alignment values
 */
export type Alignment = 'start' | 'center' | 'end' | 'stretch' | 'baseline';

/**
 * Justification values
 */
export type Justification = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

/**
 * CSS alignment value mapping
 */
export const ALIGN_MAP: Record<Alignment, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

/**
 * CSS justification value mapping
 */
export const JUSTIFY_MAP: Record<Justification, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

/**
 * Resolve a responsive value for a given breakpoint
 */
export function resolveResponsiveValue<T>(
  value: ResponsiveValue<T> | undefined,
  breakpoint: Breakpoint,
  defaultValue: T,
): T {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== 'object' || value === null) {
    return value as T;
  }

  const breakpointOrder: Breakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
  const currentIndex = breakpointOrder.indexOf(breakpoint);

  // Find the closest defined breakpoint
  for (let i = currentIndex; i >= 0; i--) {
    const bp = breakpointOrder[i];
    if (bp in value) {
      return (value as Record<Breakpoint, T>)[bp];
    }
  }

  return defaultValue;
}

/**
 * Generate CSS custom properties for responsive values
 */
export function generateResponsiveStyles<T>(
  propName: string,
  value: ResponsiveValue<T> | undefined,
  transform: (v: T) => string,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'object' || value === null) {
    return { [propName]: transform(value as T) };
  }

  const styles: Record<string, string> = {};
  const entries = Object.entries(value) as [Breakpoint, T][];

  for (const [bp, v] of entries) {
    styles[`--${propName}-${bp}`] = transform(v);
  }

  return styles;
}
