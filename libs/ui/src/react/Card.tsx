/**
 * @file Card.tsx
 * @description React Card component with static HTML rendering support.
 *
 * This is the single source of truth for the Card component. It can be used:
 * 1. As a React component: `<Card title="Hello">Content</Card>`
 * 2. As a static HTML generator: `await renderCard({ title: 'Hello', children: 'Content' })`
 *
 * @example React usage
 * ```tsx
 * import { Card } from '@frontmcp/ui/react';
 *
 * function App() {
 *   return (
 *     <Card title="Welcome" variant="elevated">
 *       <p>Card content goes here</p>
 *     </Card>
 *   );
 * }
 * ```
 *
 * @example Static HTML generation
 * ```typescript
 * import { renderCard } from '@frontmcp/ui/react';
 *
 * const html = await renderCard({
 *   title: 'Product',
 *   subtitle: 'Details',
 *   variant: 'elevated',
 *   children: '<p>Product description...</p>',
 * });
 * ```
 *
 * @module @frontmcp/ui/react/Card
 */

import React from 'react';
import type { ReactNode, ReactElement } from 'react';
import { type CardVariant, type CardSize, getCardVariantClasses, getCardSizeClasses, cn } from '../styles/variants';
import { renderToString, renderToStringSync } from '../render/prerender';

/**
 * Card component props
 */
export interface CardProps {
  /** Card title */
  title?: string;
  /** Card subtitle/description */
  subtitle?: string;
  /** Header actions (React elements) */
  headerActions?: ReactNode;
  /** Footer content (React elements) */
  footer?: ReactNode;
  /** Card variant */
  variant?: CardVariant;
  /** Card size (padding) */
  size?: CardSize;
  /** Additional CSS classes */
  className?: string;
  /** Card ID */
  id?: string;
  /** Clickable card (adds hover effects) */
  clickable?: boolean;
  /** Click handler URL */
  href?: string;
  /** Card content */
  children?: ReactNode;
}

/**
 * Card component.
 *
 * A versatile container component for grouping related content.
 * Uses Tailwind CSS classes for styling.
 */
export function Card({
  title,
  subtitle,
  headerActions,
  footer,
  variant = 'default',
  size = 'md',
  className,
  id,
  clickable,
  href,
  children,
}: CardProps): ReactElement {
  const variantClasses = getCardVariantClasses(variant);
  const sizeClasses = getCardSizeClasses(size);
  const clickableClasses = clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : '';
  const allClasses = cn(variantClasses, sizeClasses, clickableClasses, className);

  const hasHeader = title || subtitle || headerActions;

  const content = (
    <>
      {hasHeader && (
        <div className="flex items-start justify-between mb-4">
          <div>
            {title && <h3 className="text-lg font-semibold text-text-primary">{title}</h3>}
            {subtitle && <p className="text-sm text-text-secondary mt-1">{subtitle}</p>}
          </div>
          {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="mt-4 pt-4 border-t border-divider">{footer}</div>}
    </>
  );

  if (href) {
    return (
      <a href={href} className={allClasses} id={id}>
        {content}
      </a>
    );
  }

  return (
    <div className={allClasses} id={id}>
      {content}
    </div>
  );
}

/**
 * Props for static render functions (children is always a string)
 */
export interface CardRenderProps extends Omit<CardProps, 'children' | 'headerActions' | 'footer'> {
  /** Card content as HTML string */
  children?: string;
  /** Header actions as HTML string */
  headerActions?: string;
  /** Footer content as HTML string */
  footer?: string;
}

/**
 * Render Card component to static HTML string (async).
 *
 * Uses React 19's prerender API for optimal static HTML generation.
 *
 * @param props - Card props (with string children)
 * @returns Promise resolving to HTML string
 */
export async function renderCard(props: CardRenderProps): Promise<string> {
  const { children, headerActions, footer, ...rest } = props;
  const element = (
    <Card
      {...rest}
      headerActions={headerActions ? <span dangerouslySetInnerHTML={{ __html: headerActions }} /> : undefined}
      footer={footer ? <span dangerouslySetInnerHTML={{ __html: footer }} /> : undefined}
    >
      {children ? <span dangerouslySetInnerHTML={{ __html: children }} /> : undefined}
    </Card>
  );
  return renderToString(element);
}

/**
 * Render Card component to static HTML string (sync).
 *
 * Uses React's renderToStaticMarkup for synchronous rendering.
 * Does NOT wait for Suspense boundaries.
 *
 * @param props - Card props (with string children)
 * @returns HTML string
 */
export function renderCardSync(props: CardRenderProps): string {
  const { children, headerActions, footer, ...rest } = props;
  const element = (
    <Card
      {...rest}
      headerActions={headerActions ? <span dangerouslySetInnerHTML={{ __html: headerActions }} /> : undefined}
      footer={footer ? <span dangerouslySetInnerHTML={{ __html: footer }} /> : undefined}
    >
      {children ? <span dangerouslySetInnerHTML={{ __html: children }} /> : undefined}
    </Card>
  );
  return renderToStringSync(element);
}

// Re-export types
export type { CardVariant, CardSize };

export default Card;
