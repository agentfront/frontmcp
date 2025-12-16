/**
 * @file types.ts
 * @description TypeScript type declarations for FrontMCP Web Components.
 *
 * Provides JSX.IntrinsicElements augmentation for React/Preact compatibility,
 * and HTMLElementTagNameMap augmentation for TypeScript DOM APIs.
 *
 * @example React usage with types
 * ```tsx
 * import '@frontmcp/ui/web-components'; // Includes type augmentations
 *
 * function App() {
 *   return (
 *     <fmcp-button variant="primary" onClick={handleClick}>
 *       Click Me
 *     </fmcp-button>
 *   );
 * }
 * ```
 *
 * @module @frontmcp/ui/web-components/types
 */

import type { ButtonOptions } from '../components/button';
import type { CardOptions } from '../components/card';
import type { AlertOptions } from '../components/alert';
import type { BadgeOptions } from '../components/badge';
import type { InputOptions, SelectOptions } from '../components/form';

// ============================================
// Web Component Props Interfaces
// ============================================

/**
 * Props for fmcp-button element
 */
export interface FmcpButtonProps extends Partial<ButtonOptions> {
  children?: string;
  class?: string;
  style?: string;
  'onfmcp:click'?: (e: CustomEvent) => void;
  'onfmcp:render'?: (e: CustomEvent) => void;
}

/**
 * Props for fmcp-card element
 */
export interface FmcpCardProps extends Partial<Omit<CardOptions, 'title'>> {
  /** Card title (renamed to avoid conflict with HTMLElement.title) */
  'card-title'?: string;
  children?: string;
  class?: string;
  style?: string;
  'onfmcp:render'?: (e: CustomEvent) => void;
}

/**
 * Props for fmcp-alert element
 */
export interface FmcpAlertProps extends Partial<Omit<AlertOptions, 'title'>> {
  /** Alert title (renamed to avoid conflict with HTMLElement.title) */
  'alert-title'?: string;
  children?: string;
  class?: string;
  style?: string;
  'onfmcp:render'?: (e: CustomEvent) => void;
}

/**
 * Props for fmcp-badge element
 */
export interface FmcpBadgeProps extends Partial<BadgeOptions> {
  children?: string;
  class?: string;
  style?: string;
  'onfmcp:render'?: (e: CustomEvent) => void;
}

/**
 * Props for fmcp-input element
 */
export interface FmcpInputProps extends Partial<InputOptions> {
  class?: string;
  style?: string;
  'onfmcp:input'?: (e: CustomEvent<{ value: string; name: string }>) => void;
  'onfmcp:change'?: (e: CustomEvent<{ value: string; name: string }>) => void;
  'onfmcp:render'?: (e: CustomEvent) => void;
}

/**
 * Props for fmcp-select element
 */
export interface FmcpSelectProps extends Partial<SelectOptions> {
  class?: string;
  style?: string;
  'onfmcp:change'?: (e: CustomEvent<{ value: string; name: string; selectedOptions: string[] }>) => void;
  'onfmcp:render'?: (e: CustomEvent) => void;
}

// ============================================
// Global Type Augmentations
// ============================================

declare global {
  /**
   * HTMLElementTagNameMap augmentation for DOM APIs
   */
  interface HTMLElementTagNameMap {
    'fmcp-button': HTMLElement & FmcpButtonProps;
    'fmcp-card': HTMLElement & FmcpCardProps;
    'fmcp-alert': HTMLElement & FmcpAlertProps;
    'fmcp-badge': HTMLElement & FmcpBadgeProps;
    'fmcp-input': HTMLElement & FmcpInputProps;
    'fmcp-select': HTMLElement & FmcpSelectProps;
  }

  // JSX namespace for React/Preact
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'fmcp-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & FmcpButtonProps, HTMLElement>;
      'fmcp-card': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & FmcpCardProps, HTMLElement>;
      'fmcp-alert': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & FmcpAlertProps, HTMLElement>;
      'fmcp-badge': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & FmcpBadgeProps, HTMLElement>;
      'fmcp-input': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & FmcpInputProps, HTMLElement>;
      'fmcp-select': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & FmcpSelectProps, HTMLElement>;
    }
  }
}

// This export is needed to make this a module
export {};
