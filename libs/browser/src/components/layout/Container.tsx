// file: libs/browser/src/components/layout/Container.tsx
/**
 * Container Layout Component
 *
 * A responsive container with max-width constraints and centered content.
 */

import React, { forwardRef, useMemo } from 'react';
import type { CSSProperties, ElementType, ReactNode, Ref } from 'react';
import { type Breakpoint, type ResponsiveValue, type SpacingValue, BREAKPOINTS, spacingToPx } from './types';

/**
 * Container size presets
 */
export type ContainerSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | 'prose';

/**
 * Container size max-widths
 */
export const CONTAINER_SIZES: Record<ContainerSize, string> = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
  full: '100%',
  prose: '65ch',
};

/**
 * Container component props
 */
export interface ContainerProps {
  /** Children to render */
  children?: ReactNode;
  /** Container max-width size */
  size?: ResponsiveValue<ContainerSize>;
  /** Custom max-width (overrides size) */
  maxWidth?: ResponsiveValue<number | string>;
  /** Center the container */
  center?: boolean;
  /** Horizontal padding (spacing scale value) */
  paddingX?: ResponsiveValue<SpacingValue>;
  /** Vertical padding (spacing scale value) */
  paddingY?: ResponsiveValue<SpacingValue>;
  /** All-around padding (spacing scale value) */
  padding?: ResponsiveValue<SpacingValue>;
  /** Custom CSS class */
  className?: string;
  /** Inline styles */
  style?: CSSProperties;
  /** HTML element to render as */
  as?: ElementType;
  /** Test ID for testing */
  testId?: string;
  /** Background color */
  background?: string;
  /** Full height */
  fullHeight?: boolean;
  /** Fluid (100% width up to max-width) */
  fluid?: boolean;
}

/**
 * Container - A responsive container component
 *
 * @example Basic centered container
 * ```tsx
 * <Container size="lg" paddingX={4}>
 *   <h1>Page Title</h1>
 *   <p>Content goes here...</p>
 * </Container>
 * ```
 *
 * @example Responsive container
 * ```tsx
 * <Container
 *   size={{ xs: 'full', md: 'lg', xl: 'xl' }}
 *   paddingX={{ xs: 4, md: 8 }}
 * >
 *   <Content />
 * </Container>
 * ```
 *
 * @example Prose container for readable text
 * ```tsx
 * <Container size="prose" paddingY={8}>
 *   <article>
 *     <h1>Article Title</h1>
 *     <p>Long form content with optimal reading width...</p>
 *   </article>
 * </Container>
 * ```
 */
export const Container = forwardRef(function Container(
  {
    children,
    size = 'lg',
    maxWidth,
    center = true,
    paddingX = 4,
    paddingY,
    padding,
    className = '',
    style,
    as: Component = 'div',
    testId,
    background,
    fullHeight = false,
    fluid = true,
  }: ContainerProps,
  ref: Ref<HTMLElement>,
) {
  const computedStyle = useMemo((): CSSProperties => {
    const baseStyle: CSSProperties = {};

    // Max width
    if (maxWidth !== undefined) {
      if (typeof maxWidth === 'number') {
        baseStyle.maxWidth = `${maxWidth}px`;
      } else if (typeof maxWidth === 'string') {
        baseStyle.maxWidth = maxWidth;
      } else {
        const first = Object.values(maxWidth)[0];
        baseStyle.maxWidth = typeof first === 'number' ? `${first}px` : first;
      }
    } else {
      const sizeValue = typeof size === 'string' ? size : (Object.values(size)[0] as ContainerSize);
      baseStyle.maxWidth = CONTAINER_SIZES[sizeValue];
    }

    // Width
    if (fluid) {
      baseStyle.width = '100%';
    }

    // Centering
    if (center) {
      baseStyle.marginLeft = 'auto';
      baseStyle.marginRight = 'auto';
    }

    // Padding
    if (padding !== undefined) {
      const p = typeof padding === 'number' ? padding : (Object.values(padding)[0] as SpacingValue);
      baseStyle.padding = `${spacingToPx(p)}px`;
    } else {
      // PaddingX
      if (paddingX !== undefined) {
        const px = typeof paddingX === 'number' ? paddingX : (Object.values(paddingX)[0] as SpacingValue);
        baseStyle.paddingLeft = `${spacingToPx(px)}px`;
        baseStyle.paddingRight = `${spacingToPx(px)}px`;
      }

      // PaddingY
      if (paddingY !== undefined) {
        const py = typeof paddingY === 'number' ? paddingY : (Object.values(paddingY)[0] as SpacingValue);
        baseStyle.paddingTop = `${spacingToPx(py)}px`;
        baseStyle.paddingBottom = `${spacingToPx(py)}px`;
      }
    }

    // Background
    if (background) {
      baseStyle.backgroundColor = background;
    }

    // Full height
    if (fullHeight) {
      baseStyle.minHeight = '100%';
    }

    return { ...baseStyle, ...style };
  }, [size, maxWidth, center, paddingX, paddingY, padding, background, fullHeight, fluid, style]);

  return (
    <Component
      ref={ref}
      className={`frontmcp-container ${className}`.trim()}
      style={computedStyle}
      data-testid={testId}
    >
      {children}
    </Component>
  );
}) as <C extends ElementType = 'div'>(
  props: ContainerProps & { as?: C; ref?: Ref<HTMLElement> },
) => React.ReactElement | null;

/**
 * Section - A semantic section with container behavior
 */
export interface SectionProps extends Omit<ContainerProps, 'as'> {
  /** Section ID for navigation */
  id?: string;
  /** ARIA label */
  ariaLabel?: string;
  /** ARIA labelledby */
  ariaLabelledby?: string;
}

export const Section = forwardRef(function Section(
  { id, ariaLabel, ariaLabelledby, ...props }: SectionProps,
  ref: Ref<HTMLElement>,
) {
  return (
    <Container
      ref={ref}
      as="section"
      {...props}
      style={{
        ...props.style,
      }}
      testId={props.testId}
      className={props.className}
    />
  );
});
