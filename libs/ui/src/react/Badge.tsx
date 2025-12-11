/**
 * @file Badge.tsx
 * @description React Badge component with static HTML rendering support.
 *
 * This is the single source of truth for the Badge component. It can be used:
 * 1. As a React component: `<Badge variant="success">Active</Badge>`
 * 2. As a static HTML generator: `await renderBadge({ variant: 'success', children: 'Active' })`
 *
 * @example React usage
 * ```tsx
 * import { Badge } from '@frontmcp/ui/react';
 *
 * function App() {
 *   return (
 *     <Badge variant="success">Active</Badge>
 *   );
 * }
 * ```
 *
 * @example Pill badge
 * ```tsx
 * <Badge variant="info" pill>
 *   New Feature
 * </Badge>
 * ```
 *
 * @example Static HTML generation
 * ```typescript
 * import { renderBadge } from '@frontmcp/ui/react';
 *
 * const html = await renderBadge({
 *   variant: 'success',
 *   children: 'Active',
 * });
 * ```
 *
 * @module @frontmcp/ui/react/Badge
 */

import React from 'react';
import type { ReactNode, ReactElement } from 'react';
import {
  type BadgeVariant,
  type BadgeSize,
  getBadgeVariantClasses,
  getBadgeSizeClasses,
  getBadgeDotSizeClasses,
  getBadgeDotVariantClasses,
  CLOSE_ICON,
  cn,
} from '../styles/variants';
import { renderToString, renderToStringSync } from '../render/prerender';

/**
 * Badge component props
 */
export interface BadgeProps {
  /** Badge variant */
  variant?: BadgeVariant;
  /** Badge size */
  size?: BadgeSize;
  /** Rounded pill style */
  pill?: boolean;
  /** Icon before text (React element) */
  icon?: ReactNode;
  /** Dot indicator (no text) */
  dot?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Removable badge */
  removable?: boolean;
  /** Remove callback */
  onRemove?: () => void;
  /** Badge content */
  children?: ReactNode;
}

/**
 * Badge component.
 *
 * A small status indicator or label component.
 * Uses Tailwind CSS classes for styling.
 */
export function Badge({
  variant = 'default',
  size = 'md',
  pill = false,
  icon,
  dot = false,
  className,
  removable = false,
  onRemove,
  children,
}: BadgeProps): ReactElement {
  // Handle dot badge (status indicator)
  if (dot) {
    const dotClasses = cn(
      'inline-block rounded-full',
      getBadgeDotSizeClasses(size),
      getBadgeDotVariantClasses(variant),
      className,
    );

    const label = typeof children === 'string' ? children : undefined;

    return <span className={dotClasses} aria-label={label} title={label} />;
  }

  const variantClasses = getBadgeVariantClasses(variant);
  const sizeClasses = getBadgeSizeClasses(size);

  const baseClasses = cn(
    'inline-flex items-center font-medium',
    pill ? 'rounded-full' : 'rounded-md',
    variantClasses,
    sizeClasses,
    className,
  );

  return (
    <span className={baseClasses}>
      {icon && <span className="mr-1">{icon}</span>}
      {children}
      {removable && (
        <button
          type="button"
          className="ml-1.5 -mr-1 hover:opacity-70 transition-opacity"
          aria-label="Remove"
          onClick={onRemove}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

/**
 * Props for static render functions (children is always a string)
 */
export interface BadgeRenderProps extends Omit<BadgeProps, 'children' | 'icon' | 'onRemove'> {
  /** Badge content as string */
  children?: string;
  /** Icon as HTML string */
  icon?: string;
}

/**
 * Render Badge component to static HTML string (async).
 *
 * Uses React 19's prerender API for optimal static HTML generation.
 *
 * @param props - Badge props (with string children)
 * @returns Promise resolving to HTML string
 */
export async function renderBadge(props: BadgeRenderProps): Promise<string> {
  const { children, icon, ...rest } = props;
  const element = (
    <Badge {...rest} icon={icon ? <span dangerouslySetInnerHTML={{ __html: icon }} /> : undefined}>
      {children}
    </Badge>
  );
  return renderToString(element);
}

/**
 * Render Badge component to static HTML string (sync).
 *
 * Uses React's renderToStaticMarkup for synchronous rendering.
 * Does NOT wait for Suspense boundaries.
 *
 * @param props - Badge props (with string children)
 * @returns HTML string
 */
export function renderBadgeSync(props: BadgeRenderProps): string {
  const { children, icon, ...rest } = props;
  const element = (
    <Badge {...rest} icon={icon ? <span dangerouslySetInnerHTML={{ __html: icon }} /> : undefined}>
      {children}
    </Badge>
  );
  return renderToStringSync(element);
}

// Re-export types
export type { BadgeVariant, BadgeSize };

export default Badge;
