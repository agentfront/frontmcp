/**
 * Modal Component
 *
 * Dialog and modal components.
 */

import { escapeHtml } from '../layouts/base';

// ============================================
// Modal Types
// ============================================

/**
 * Modal size options
 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/**
 * Modal component options
 */
export interface ModalOptions {
  /** Modal ID */
  id: string;
  /** Modal title */
  title?: string;
  /** Modal size */
  size?: ModalSize;
  /** Show close button */
  showClose?: boolean;
  /** Close on backdrop click */
  closeOnBackdrop?: boolean;
  /** Close on escape key */
  closeOnEscape?: boolean;
  /** Footer content */
  footer?: string;
  /** Additional CSS classes for modal */
  className?: string;
  /** Initially visible */
  open?: boolean;
}

// ============================================
// Modal Builder
// ============================================

/**
 * Get size CSS classes
 */
function getSizeClasses(size: ModalSize): string {
  const sizes: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    full: 'max-w-full mx-4',
  };
  return sizes[size];
}

/**
 * Build a modal component
 */
export function modal(content: string, options: ModalOptions): string {
  const {
    id,
    title,
    size = 'md',
    showClose = true,
    closeOnBackdrop = true,
    closeOnEscape = true,
    footer,
    className = '',
    open = false,
  } = options;

  const sizeClasses = getSizeClasses(size);
  const visibilityClasses = open ? '' : 'hidden';

  const headerHtml =
    title || showClose
      ? `<div class="flex items-center justify-between p-4 border-b border-divider">
        ${title ? `<h3 class="text-lg font-semibold text-text-primary">${escapeHtml(title)}</h3>` : '<div></div>'}
        ${
          showClose
            ? `
          <button
            type="button"
            class="p-1 rounded-lg text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            onclick="document.getElementById('${escapeHtml(id)}').classList.add('hidden')"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        `
            : ''
        }
      </div>`
      : '';

  const footerHtml = footer
    ? `<div class="flex items-center justify-end gap-3 p-4 border-t border-divider">
        ${footer}
      </div>`
    : '';

  const backdropClickHandler = closeOnBackdrop
    ? `onclick="if (event.target === this) this.classList.add('hidden')"`
    : '';

  const escapeHandler = closeOnEscape
    ? `<script>
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') {
            document.getElementById('${escapeHtml(id)}')?.classList.add('hidden');
          }
        });
      </script>`
    : '';

  return `
    <div
      id="${escapeHtml(id)}"
      class="fixed inset-0 z-50 overflow-y-auto ${visibilityClasses}"
      ${backdropClickHandler}
      role="dialog"
      aria-modal="true"
      aria-labelledby="${escapeHtml(id)}-title"
    >
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/50 transition-opacity"></div>

      <!-- Modal container -->
      <div class="flex min-h-full items-center justify-center p-4">
        <div class="relative w-full ${sizeClasses} bg-white rounded-xl shadow-xl ${className}">
          ${headerHtml}
          <div class="p-4">
            ${content}
          </div>
          ${footerHtml}
        </div>
      </div>
    </div>
    ${escapeHandler}
  `;
}

// ============================================
// Modal Trigger
// ============================================

/**
 * Build a modal trigger button/element
 */
export function modalTrigger(
  triggerContent: string,
  modalId: string,
  options: { className?: string; tag?: 'button' | 'a' | 'span' } = {},
): string {
  const { className = '', tag = 'button' } = options;

  const attrs = `
    class="${className}"
    onclick="document.getElementById('${escapeHtml(modalId)}').classList.remove('hidden')"
  `;

  if (tag === 'button') {
    return `<button type="button" ${attrs}>${triggerContent}</button>`;
  }

  return `<${tag} ${attrs}>${triggerContent}</${tag}>`;
}

// ============================================
// Confirmation Modal
// ============================================

/**
 * Confirmation modal options
 */
export interface ConfirmModalOptions {
  /** Modal ID */
  id: string;
  /** Dialog title */
  title?: string;
  /** Confirmation message */
  message: string;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Confirm button variant */
  variant?: 'primary' | 'danger' | 'warning';
  /** Icon */
  icon?: string;
  /** Confirm action URL */
  confirmHref?: string;
}

/**
 * Build a confirmation modal
 */
export function confirmModal(options: ConfirmModalOptions): string {
  const {
    id,
    title = 'Confirm Action',
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'primary',
    icon,
    confirmHref,
  } = options;

  const variantClasses: Record<string, string> = {
    primary: 'bg-primary hover:bg-primary/90 text-white',
    danger: 'bg-danger hover:bg-danger/90 text-white',
    warning: 'bg-warning hover:bg-warning/90 text-white',
  };

  const iconColors: Record<string, string> = {
    primary: 'text-primary bg-primary/10',
    danger: 'text-danger bg-danger/10',
    warning: 'text-warning bg-warning/10',
  };

  const defaultIcons: Record<string, string> = {
    primary: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>`,
    danger: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
    </svg>`,
    warning: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
    </svg>`,
  };

  const displayIcon = icon || defaultIcons[variant];

  const content = `
    <div class="text-center">
      <div class="mx-auto w-12 h-12 rounded-full ${iconColors[variant]} flex items-center justify-center mb-4">
        ${displayIcon}
      </div>
      <h3 class="text-lg font-semibold text-text-primary mb-2">${escapeHtml(title)}</h3>
      <p class="text-text-secondary">${escapeHtml(message)}</p>
    </div>
  `;

  const confirmButton = confirmHref
    ? `<a
        href="${escapeHtml(confirmHref)}"
        class="px-4 py-2 rounded-lg ${variantClasses[variant]} transition-colors"
      >
        ${escapeHtml(confirmText)}
      </a>`
    : `<button
        type="button"
        class="px-4 py-2 rounded-lg ${variantClasses[variant]} transition-colors"
        onclick="document.getElementById('${escapeHtml(id)}').classList.add('hidden')"
      >
        ${escapeHtml(confirmText)}
      </button>`;

  const footer = `
    <button
      type="button"
      class="px-4 py-2 rounded-lg border border-border text-text-primary hover:bg-gray-50 transition-colors"
      onclick="document.getElementById('${escapeHtml(id)}').classList.add('hidden')"
    >
      ${escapeHtml(cancelText)}
    </button>
    ${confirmButton}
  `;

  return modal(content, {
    id,
    size: 'sm',
    showClose: false,
    footer,
  });
}

// ============================================
// Drawer Component
// ============================================

/**
 * Drawer position options
 */
export type DrawerPosition = 'left' | 'right' | 'top' | 'bottom';

/**
 * Drawer options
 */
export interface DrawerOptions {
  /** Drawer ID */
  id: string;
  /** Drawer title */
  title?: string;
  /** Drawer position */
  position?: DrawerPosition;
  /** Drawer size (width for left/right, height for top/bottom) */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Show close button */
  showClose?: boolean;
  /** Close on backdrop click */
  closeOnBackdrop?: boolean;
  /** Footer content */
  footer?: string;
  /** Additional CSS classes */
  className?: string;
  /** Initially visible */
  open?: boolean;
}

/**
 * Build a drawer component
 */
export function drawer(content: string, options: DrawerOptions): string {
  const {
    id,
    title,
    position = 'right',
    size = 'md',
    showClose = true,
    closeOnBackdrop = true,
    footer,
    className = '',
    open = false,
  } = options;

  const sizeClasses: Record<string, Record<string, string>> = {
    left: { sm: 'w-64', md: 'w-80', lg: 'w-96', xl: 'w-[32rem]' },
    right: { sm: 'w-64', md: 'w-80', lg: 'w-96', xl: 'w-[32rem]' },
    top: { sm: 'h-32', md: 'h-48', lg: 'h-64', xl: 'h-96' },
    bottom: { sm: 'h-32', md: 'h-48', lg: 'h-64', xl: 'h-96' },
  };

  const positionClasses: Record<DrawerPosition, string> = {
    left: 'inset-y-0 left-0',
    right: 'inset-y-0 right-0',
    top: 'inset-x-0 top-0',
    bottom: 'inset-x-0 bottom-0',
  };

  const fullSizeClasses: Record<DrawerPosition, string> = {
    left: 'h-full',
    right: 'h-full',
    top: 'w-full',
    bottom: 'w-full',
  };

  const visibilityClasses = open ? '' : 'hidden';

  const headerHtml =
    title || showClose
      ? `<div class="flex items-center justify-between p-4 border-b border-divider">
        ${title ? `<h3 class="text-lg font-semibold text-text-primary">${escapeHtml(title)}</h3>` : '<div></div>'}
        ${
          showClose
            ? `
          <button
            type="button"
            class="p-1 rounded-lg text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            onclick="document.getElementById('${escapeHtml(id)}').classList.add('hidden')"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        `
            : ''
        }
      </div>`
      : '';

  const footerHtml = footer ? `<div class="p-4 border-t border-divider">${footer}</div>` : '';

  const backdropClickHandler = closeOnBackdrop
    ? `onclick="if (event.target === this) this.classList.add('hidden')"`
    : '';

  return `
    <div
      id="${escapeHtml(id)}"
      class="fixed inset-0 z-50 ${visibilityClasses}"
      ${backdropClickHandler}
      role="dialog"
      aria-modal="true"
    >
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/50 transition-opacity"></div>

      <!-- Drawer -->
      <div class="fixed ${positionClasses[position]} ${sizeClasses[position][size]} ${
    fullSizeClasses[position]
  } bg-white shadow-xl flex flex-col ${className}">
        ${headerHtml}
        <div class="flex-1 overflow-y-auto p-4">
          ${content}
        </div>
        ${footerHtml}
      </div>
    </div>
  `;
}
