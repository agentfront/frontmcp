/**
 * @file Alert.tsx
 * @description React Alert component with static HTML rendering support.
 *
 * This is the single source of truth for the Alert component. It can be used:
 * 1. As a React component: `<Alert variant="success" title="Success!">Message</Alert>`
 * 2. As a static HTML generator: `await renderAlert({ variant: 'success', children: 'Message' })`
 *
 * @example React usage
 * ```tsx
 * import { Alert } from '@frontmcp/ui/react';
 *
 * function App() {
 *   return (
 *     <Alert variant="success" title="Success!">
 *       Your changes have been saved.
 *     </Alert>
 *   );
 * }
 * ```
 *
 * @example Dismissible alert
 * ```tsx
 * <Alert variant="warning" dismissible onDismiss={() => setShow(false)}>
 *   This action cannot be undone.
 * </Alert>
 * ```
 *
 * @example Static HTML generation
 * ```typescript
 * import { renderAlert } from '@frontmcp/ui/react';
 *
 * const html = await renderAlert({
 *   variant: 'info',
 *   title: 'Note',
 *   children: 'Please review before submitting.',
 * });
 * ```
 *
 * @module @frontmcp/ui/react/Alert
 */

import React from 'react';
import type { ReactNode, ReactElement } from 'react';
import {
  type AlertVariant,
  getAlertVariantClasses,
  ALERT_BASE_CLASSES,
  ALERT_ICONS,
  CLOSE_ICON,
  cn,
} from '../styles/variants';
import { renderToString, renderToStringSync } from '../render/prerender';

/**
 * Alert component props
 */
export interface AlertProps {
  /** Alert variant */
  variant?: AlertVariant;
  /** Alert title */
  title?: string;
  /** Custom icon (React element) */
  icon?: ReactNode;
  /** Show default icon based on variant */
  showIcon?: boolean;
  /** Dismissible alert */
  dismissible?: boolean;
  /** Dismiss callback */
  onDismiss?: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Alert content */
  children?: ReactNode;
}

/**
 * Alert component.
 *
 * A notification component for displaying important messages.
 * Uses Tailwind CSS classes for styling.
 */
export function Alert({
  variant = 'info',
  title,
  icon,
  showIcon = true,
  dismissible = false,
  onDismiss,
  className,
  children,
}: AlertProps): ReactElement {
  const variantStyles = getAlertVariantClasses(variant);

  const allClasses = cn(ALERT_BASE_CLASSES, variantStyles.container, className);

  // Use custom icon or default variant icon
  const iconContent =
    icon ||
    (showIcon ? (
      <span
        className={cn('flex-shrink-0', variantStyles.icon)}
        dangerouslySetInnerHTML={{ __html: ALERT_ICONS[variant] }}
      />
    ) : null);

  return (
    <div className={allClasses} role="alert">
      <div className="flex">
        {iconContent && <div className="flex-shrink-0 mr-3">{iconContent}</div>}
        <div className="flex-1">
          {title && <h4 className="font-semibold mb-1">{title}</h4>}
          <div className="text-sm">{children}</div>
        </div>
        {dismissible && (
          <button
            type="button"
            className="flex-shrink-0 ml-3 hover:opacity-70 transition-opacity"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            <span dangerouslySetInnerHTML={{ __html: CLOSE_ICON }} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Props for static render functions (children is always a string)
 */
export interface AlertRenderProps extends Omit<AlertProps, 'children' | 'icon' | 'onDismiss'> {
  /** Alert content as string */
  children?: string;
  /** Icon as HTML string */
  icon?: string;
}

/**
 * Render Alert component to static HTML string (async).
 *
 * Uses React 19's prerender API for optimal static HTML generation.
 *
 * @param props - Alert props (with string children)
 * @returns Promise resolving to HTML string
 */
export async function renderAlert(props: AlertRenderProps): Promise<string> {
  const { children, icon, ...rest } = props;
  const element = (
    <Alert {...rest} icon={icon ? <span dangerouslySetInnerHTML={{ __html: icon }} /> : undefined}>
      {children}
    </Alert>
  );
  return renderToString(element);
}

/**
 * Render Alert component to static HTML string (sync).
 *
 * Uses React's renderToStaticMarkup for synchronous rendering.
 * Does NOT wait for Suspense boundaries.
 *
 * @param props - Alert props (with string children)
 * @returns HTML string
 */
export function renderAlertSync(props: AlertRenderProps): string {
  const { children, icon, ...rest } = props;
  const element = (
    <Alert {...rest} icon={icon ? <span dangerouslySetInnerHTML={{ __html: icon }} /> : undefined}>
      {children}
    </Alert>
  );
  return renderToStringSync(element);
}

// Re-export types
export type { AlertVariant };

export default Alert;
