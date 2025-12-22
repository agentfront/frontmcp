/**
 * @file types.ts
 * @description TypeScript types for React wrapper components.
 *
 * Re-exports element types from web-components for use with React refs,
 * and defines React-specific prop interfaces.
 *
 * @module @frontmcp/ui/react/types
 */

import type { ReactNode } from 'react';
import type {
  CardOptions,
  CardVariant,
  CardSize,
  BadgeOptions,
  BadgeVariant,
  BadgeSize,
  ButtonOptions,
  AlertOptions,
} from '@frontmcp/uipack/components';

// Re-export element classes for ref typing
export type {
  FmcpButton,
  FmcpCard,
  FmcpAlert,
  FmcpBadge,
  FmcpInput,
  FmcpSelect,
} from '@frontmcp/uipack/web-components';

// ============================================
// Card Props
// ============================================

/**
 * React props for Card component
 */
export interface CardProps {
  /** Card title */
  title?: string;
  /** Card subtitle/description */
  subtitle?: string;
  /** Header actions content */
  headerActions?: ReactNode;
  /** Footer content */
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
  children: ReactNode;
}

// ============================================
// Badge Props
// ============================================

/**
 * React props for Badge component
 */
export interface BadgeProps {
  /** Badge variant */
  variant?: BadgeVariant;
  /** Badge size */
  size?: BadgeSize;
  /** Rounded pill style */
  pill?: boolean;
  /** Icon before text (ReactNode) */
  icon?: ReactNode;
  /** Dot indicator (no text) */
  dot?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Removable badge */
  removable?: boolean;
  /** Badge content */
  children?: ReactNode;
}

// ============================================
// Button Props
// ============================================

/**
 * React props for Button component
 */
export interface ButtonProps {
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  /** Button size */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Full width */
  fullWidth?: boolean;
  /** Icon position */
  iconPosition?: 'left' | 'right';
  /** Icon content */
  icon?: ReactNode;
  /** Button type */
  type?: 'button' | 'submit' | 'reset';
  /** Additional CSS classes */
  className?: string;
  /** Click handler */
  onClick?: () => void;
  /** Button content */
  children: ReactNode;
}

// ============================================
// Alert Props
// ============================================

/**
 * React props for Alert component
 */
export interface AlertProps {
  /** Alert variant */
  variant?: 'info' | 'success' | 'warning' | 'danger';
  /** Alert title */
  title?: string;
  /** Icon content */
  icon?: ReactNode;
  /** Dismissible */
  dismissible?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Alert content */
  children: ReactNode;
}

// ============================================
// Re-export schema types for convenience
// ============================================

export type { CardOptions, CardVariant, CardSize, BadgeOptions, BadgeVariant, BadgeSize, ButtonOptions, AlertOptions };
