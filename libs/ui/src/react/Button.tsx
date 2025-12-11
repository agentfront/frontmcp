/**
 * @file Button.tsx
 * @description React Button component with static HTML rendering support.
 *
 * This is the single source of truth for the Button component. It can be used:
 * 1. As a React component: `<Button variant="primary">Click Me</Button>`
 * 2. As a static HTML generator: `await renderButton({ variant: 'primary', children: 'Click Me' })`
 *
 * @example React usage
 * ```tsx
 * import { Button } from '@frontmcp/ui/react';
 *
 * function App() {
 *   return (
 *     <Button variant="primary" onClick={() => alert('Clicked!')}>
 *       Click Me
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example With loading state
 * ```tsx
 * <Button variant="primary" loading>
 *   Saving...
 * </Button>
 * ```
 *
 * @example Static HTML generation
 * ```typescript
 * import { renderButton } from '@frontmcp/ui/react';
 *
 * const html = await renderButton({
 *   variant: 'primary',
 *   children: 'Submit',
 * });
 * ```
 *
 * @module @frontmcp/ui/react/Button
 */

import React from 'react';
import type { ReactNode, ReactElement } from 'react';
import {
  type ButtonVariant,
  type ButtonSize,
  getButtonVariantClasses,
  getButtonSizeClasses,
  BUTTON_BASE_CLASSES,
  LOADING_SPINNER,
  cn,
} from '../styles/variants';
import { renderToString, renderToStringSync } from '../render/prerender';

/**
 * Button component props
 */
export interface ButtonProps {
  /** Button variant */
  variant?: ButtonVariant;
  /** Button size */
  size?: ButtonSize;
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Full width */
  fullWidth?: boolean;
  /** Icon position */
  iconPosition?: 'left' | 'right';
  /** Icon content (React element) */
  icon?: ReactNode;
  /** Icon only (no text) */
  iconOnly?: boolean;
  /** Button type */
  type?: 'button' | 'submit' | 'reset';
  /** Additional CSS classes */
  className?: string;
  /** Click handler */
  onClick?: () => void;
  /** Button content */
  children?: ReactNode;
}

/**
 * Button component.
 *
 * A versatile button component with multiple variants, sizes, and states.
 * Uses Tailwind CSS classes for styling.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  iconPosition = 'left',
  icon,
  iconOnly = false,
  type = 'button',
  className,
  onClick,
  children,
}: ButtonProps): ReactElement {
  const variantClasses = getButtonVariantClasses(variant);
  const sizeClasses = getButtonSizeClasses(size, iconOnly);

  const disabledClasses = disabled || loading ? 'opacity-50 cursor-not-allowed' : '';
  const widthClasses = fullWidth ? 'w-full' : '';

  const allClasses = cn(BUTTON_BASE_CLASSES, variantClasses, sizeClasses, disabledClasses, widthClasses, className);

  const iconElement = icon && <span className={iconPosition === 'left' ? 'mr-2' : 'ml-2'}>{icon}</span>;

  return (
    <button type={type} className={allClasses} disabled={disabled || loading} onClick={onClick}>
      {loading && <span className="mr-2" dangerouslySetInnerHTML={{ __html: LOADING_SPINNER }} />}
      {!loading && icon && iconPosition === 'left' && iconElement}
      {!iconOnly && children}
      {!loading && icon && iconPosition === 'right' && iconElement}
    </button>
  );
}

/**
 * Props for static render functions (children is always a string)
 */
export interface ButtonRenderProps extends Omit<ButtonProps, 'children' | 'icon' | 'onClick'> {
  /** Button content as string */
  children?: string;
  /** Icon as HTML string */
  icon?: string;
}

/**
 * Render Button component to static HTML string (async).
 *
 * Uses React 19's prerender API for optimal static HTML generation.
 *
 * @param props - Button props (with string children)
 * @returns Promise resolving to HTML string
 */
export async function renderButton(props: ButtonRenderProps): Promise<string> {
  const { children, icon, ...rest } = props;
  const element = (
    <Button {...rest} icon={icon ? <span dangerouslySetInnerHTML={{ __html: icon }} /> : undefined}>
      {children}
    </Button>
  );
  return renderToString(element);
}

/**
 * Render Button component to static HTML string (sync).
 *
 * Uses React's renderToStaticMarkup for synchronous rendering.
 * Does NOT wait for Suspense boundaries.
 *
 * @param props - Button props (with string children)
 * @returns HTML string
 */
export function renderButtonSync(props: ButtonRenderProps): string {
  const { children, icon, ...rest } = props;
  const element = (
    <Button {...rest} icon={icon ? <span dangerouslySetInnerHTML={{ __html: icon }} /> : undefined}>
      {children}
    </Button>
  );
  return renderToStringSync(element);
}

// Re-export types
export type { ButtonVariant, ButtonSize };

export default Button;
