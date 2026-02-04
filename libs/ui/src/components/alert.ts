/**
 * Alert Component
 *
 * Notification and message display components.
 */

import { escapeHtml } from '../layouts/base';
import { sanitizeHtmlContent } from '@frontmcp/uipack/runtime';

// ============================================
// Alert Types
// ============================================

/**
 * Alert variant styles
 */
export type AlertVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/**
 * Alert component options.
 *
 * **Security Note**: The `icon` and `actions` parameters accept raw HTML.
 * Do NOT pass untrusted user input to these parameters without sanitization.
 * Use `escapeHtml()` from `@frontmcp/ui/layouts` for text content, or use the
 * `sanitize` option to automatically sanitize HTML content.
 */
export interface AlertOptions {
  /** Alert variant */
  variant?: AlertVariant;
  /** Alert title */
  title?: string;
  /** Show icon */
  showIcon?: boolean;
  /**
   * Custom icon (overrides default, raw HTML).
   * **Warning**: Do not pass untrusted user input without sanitization.
   */
  icon?: string;
  /** Dismissible alert */
  dismissible?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Alert ID */
  id?: string;
  /**
   * Actions (buttons, raw HTML).
   * **Warning**: Do not pass untrusted user input without sanitization.
   */
  actions?: string;
  /**
   * If true, sanitizes HTML content to prevent XSS.
   * Removes script tags, event handlers, and dangerous attributes.
   * @default false
   */
  sanitize?: boolean;
}

// ============================================
// Alert Icons
// ============================================

const alertIcons: Record<AlertVariant, string> = {
  info: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`,
  success: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`,
  warning: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
  </svg>`,
  danger: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`,
  neutral: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
  </svg>`,
};

// ============================================
// Alert Builder
// ============================================

/**
 * Get variant CSS classes
 */
function getVariantClasses(variant: AlertVariant): { container: string; icon: string } {
  const variants: Record<AlertVariant, { container: string; icon: string }> = {
    info: {
      container: 'bg-blue-50 border-blue-200 text-blue-800',
      icon: 'text-blue-500',
    },
    success: {
      container: 'bg-success/10 border-success/30 text-success',
      icon: 'text-success',
    },
    warning: {
      container: 'bg-warning/10 border-warning/30 text-warning',
      icon: 'text-warning',
    },
    danger: {
      container: 'bg-danger/10 border-danger/30 text-danger',
      icon: 'text-danger',
    },
    neutral: {
      container: 'bg-gray-50 border-gray-200 text-gray-800',
      icon: 'text-gray-500',
    },
  };
  return variants[variant];
}

/**
 * Build an alert component
 */
export function alert(message: string, options: AlertOptions = {}): string {
  const {
    variant = 'info',
    title,
    showIcon = true,
    icon,
    dismissible = false,
    className = '',
    id,
    actions,
    sanitize = false,
  } = options;

  // Sanitize raw HTML content if requested
  // codeql[js/html-constructed-from-input]: icon and actions are intentionally raw HTML for composability; sanitize option available
  const safeIcon = sanitize && icon ? sanitizeHtmlContent(icon) : icon;
  const safeActions = sanitize && actions ? sanitizeHtmlContent(actions) : actions;

  const variantClasses = getVariantClasses(variant);

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  const baseClasses = ['rounded-lg border p-4', variantClasses.container, safeClassName].filter(Boolean).join(' ');

  const iconHtml = showIcon
    ? `<div class="flex-shrink-0 ${variantClasses.icon}">
        ${safeIcon || alertIcons[variant]}
      </div>`
    : '';

  const titleHtml = title ? `<h3 class="font-semibold">${escapeHtml(title)}</h3>` : '';

  const dismissHtml = dismissible
    ? `<button
        type="button"
        class="flex-shrink-0 ml-auto -mr-1 -mt-1 p-1 rounded hover:bg-black/5 transition-colors"
        onclick="this.closest('.alert').remove()"
        aria-label="Dismiss"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>`
    : '';

  const actionsHtml = safeActions ? `<div class="mt-3">${safeActions}</div>` : '';

  const idAttr = id ? `id="${escapeHtml(id)}"` : '';

  return `<div class="alert ${baseClasses}" role="alert" ${idAttr}>
    <div class="flex gap-3">
      ${iconHtml}
      <div class="flex-1">
        ${titleHtml}
        <div class="${title ? 'mt-1' : ''}">${escapeHtml(message)}</div>
        ${actionsHtml}
      </div>
      ${dismissHtml}
    </div>
  </div>`;
}

// ============================================
// Alert Presets
// ============================================

/** Info alert shorthand */
export const infoAlert = (message: string, opts?: Omit<AlertOptions, 'variant'>) =>
  alert(message, { ...opts, variant: 'info' });

/** Success alert shorthand */
export const successAlert = (message: string, opts?: Omit<AlertOptions, 'variant'>) =>
  alert(message, { ...opts, variant: 'success' });

/** Warning alert shorthand */
export const warningAlert = (message: string, opts?: Omit<AlertOptions, 'variant'>) =>
  alert(message, { ...opts, variant: 'warning' });

/** Danger/error alert shorthand */
export const dangerAlert = (message: string, opts?: Omit<AlertOptions, 'variant'>) =>
  alert(message, { ...opts, variant: 'danger' });

// ============================================
// Toast Component
// ============================================

/**
 * Toast notification options
 */
export interface ToastOptions {
  /** Toast variant */
  variant?: AlertVariant;
  /** Toast title */
  title?: string;
  /** Duration in ms (0 = no auto-dismiss) */
  duration?: number;
  /** Position */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  /** Toast ID */
  id?: string;
}

/**
 * Build a toast notification
 */
export function toast(message: string, options: ToastOptions = {}): string {
  const { variant = 'info', title, duration = 5000, position = 'top-right', id = `toast-${Date.now()}` } = options;

  const variantClasses = getVariantClasses(variant);

  const positionClasses: Record<string, string> = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-center': 'top-4 left-1/2 -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
  };

  const titleHtml = title ? `<h4 class="font-semibold">${escapeHtml(title)}</h4>` : '';

  const autoDismissScript =
    duration > 0
      ? `<script>
        setTimeout(() => {
          const toast = document.getElementById('${id}');
          if (toast) {
            toast.classList.add('opacity-0', 'translate-x-2');
            setTimeout(() => toast.remove(), 300);
          }
        }, ${duration});
      </script>`
      : '';

  return `<div
    id="${escapeHtml(id)}"
    class="fixed ${positionClasses[position]} z-50 min-w-[300px] max-w-md rounded-lg border shadow-lg ${
      variantClasses.container
    } transition-all duration-300 transform"
    role="alert"
  >
    <div class="flex gap-3 p-4">
      <div class="flex-shrink-0 ${variantClasses.icon}">
        ${alertIcons[variant]}
      </div>
      <div class="flex-1">
        ${titleHtml}
        <p class="${title ? 'mt-1 text-sm opacity-90' : ''}">${escapeHtml(message)}</p>
      </div>
      <button
        type="button"
        class="flex-shrink-0 p-1 rounded hover:bg-black/5 transition-colors"
        onclick="this.closest('#${id}').remove()"
        aria-label="Close"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>
  ${autoDismissScript}`;
}

/**
 * Build a toast container (for multiple toasts)
 */
export function toastContainer(position: ToastOptions['position'] = 'top-right', id = 'toast-container'): string {
  const positionClasses: Record<string, string> = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-center': 'top-4 left-1/2 -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
  };

  return `<div id="${escapeHtml(id)}" class="fixed ${positionClasses[position]} z-50 flex flex-col gap-2"></div>`;
}
