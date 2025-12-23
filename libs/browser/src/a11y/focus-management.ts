// file: libs/browser/src/a11y/focus-management.ts
/**
 * Focus Management Utilities
 *
 * Utilities for managing keyboard focus in accessible applications.
 */

/**
 * Selector for focusable elements
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Selector for tabbable elements (excludes tabindex="-1")
 */
export const TABBABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'area[href]:not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'iframe:not([tabindex="-1"])',
  '[contenteditable]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(elements).filter((el) => isElementVisible(el));
}

/**
 * Get all tabbable elements within a container (in tab order)
 */
export function getTabbableElements(container: HTMLElement): HTMLElement[] {
  const elements = container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR);
  return Array.from(elements)
    .filter((el) => isElementVisible(el))
    .sort((a, b) => {
      const aIndex = parseInt(a.getAttribute('tabindex') ?? '0', 10);
      const bIndex = parseInt(b.getAttribute('tabindex') ?? '0', 10);
      if (aIndex === bIndex) return 0;
      if (aIndex === 0) return 1;
      if (bIndex === 0) return -1;
      return aIndex - bIndex;
    });
}

/**
 * Check if an element is visible
 */
export function isElementVisible(element: HTMLElement): boolean {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  // Check if element or ancestors are hidden
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return false;
  }

  return true;
}

/**
 * Focus trap options
 */
export interface FocusTrapOptions {
  /** Element to trap focus within */
  container: HTMLElement;
  /** Initial element to focus */
  initialFocus?: HTMLElement | null;
  /** Element to return focus to on deactivation */
  returnFocus?: HTMLElement | null;
  /** Whether to prevent scroll on focus */
  preventScroll?: boolean;
  /** Whether escape key deactivates trap */
  escapeDeactivates?: boolean;
  /** Callback when escape is pressed */
  onEscape?: () => void;
  /** Callback when focus leaves the container */
  onFocusLeave?: () => void;
}

/**
 * Focus trap instance
 */
export interface FocusTrap {
  /** Activate the focus trap */
  activate: () => void;
  /** Deactivate the focus trap */
  deactivate: () => void;
  /** Check if trap is active */
  isActive: () => boolean;
  /** Update the container */
  updateContainer: (container: HTMLElement) => void;
}

/**
 * Create a focus trap
 *
 * @example
 * ```tsx
 * const trap = createFocusTrap({
 *   container: dialogRef.current,
 *   initialFocus: inputRef.current,
 *   returnFocus: buttonRef.current,
 *   escapeDeactivates: true,
 *   onEscape: () => setIsOpen(false),
 * });
 *
 * useEffect(() => {
 *   if (isOpen) {
 *     trap.activate();
 *   } else {
 *     trap.deactivate();
 *   }
 *   return () => trap.deactivate();
 * }, [isOpen]);
 * ```
 */
export function createFocusTrap(options: FocusTrapOptions): FocusTrap {
  let active = false;
  let container = options.container;
  let returnFocusElement = options.returnFocus ?? (document.activeElement as HTMLElement);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!active) return;

    if (event.key === 'Escape' && options.escapeDeactivates !== false) {
      options.onEscape?.();
      return;
    }

    if (event.key === 'Tab') {
      const tabbable = getTabbableElements(container);
      if (tabbable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: options.preventScroll });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: options.preventScroll });
      }
    }
  };

  const handleFocusIn = (event: FocusEvent) => {
    if (!active) return;

    const target = event.target as HTMLElement;
    if (!container.contains(target)) {
      options.onFocusLeave?.();
      // Return focus to container
      const tabbable = getTabbableElements(container);
      if (tabbable.length > 0) {
        tabbable[0].focus({ preventScroll: options.preventScroll });
      }
    }
  };

  return {
    activate() {
      if (active) return;
      active = true;

      returnFocusElement = options.returnFocus ?? (document.activeElement as HTMLElement);

      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('focusin', handleFocusIn);

      // Focus initial element or first tabbable
      const initialFocus = options.initialFocus ?? getTabbableElements(container)[0];
      if (initialFocus) {
        requestAnimationFrame(() => {
          initialFocus.focus({ preventScroll: options.preventScroll });
        });
      }
    },

    deactivate() {
      if (!active) return;
      active = false;

      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);

      // Return focus
      if (returnFocusElement && isElementVisible(returnFocusElement)) {
        returnFocusElement.focus({ preventScroll: options.preventScroll });
      }
    },

    isActive() {
      return active;
    },

    updateContainer(newContainer: HTMLElement) {
      container = newContainer;
    },
  };
}

/**
 * Focus the first focusable element in a container
 */
export function focusFirst(container: HTMLElement, preventScroll = false): HTMLElement | null {
  const elements = getTabbableElements(container);
  if (elements.length > 0) {
    elements[0].focus({ preventScroll });
    return elements[0];
  }
  return null;
}

/**
 * Focus the last focusable element in a container
 */
export function focusLast(container: HTMLElement, preventScroll = false): HTMLElement | null {
  const elements = getTabbableElements(container);
  if (elements.length > 0) {
    const last = elements[elements.length - 1];
    last.focus({ preventScroll });
    return last;
  }
  return null;
}

/**
 * Store and restore focus
 */
export function createFocusStore(): {
  save: () => void;
  restore: (preventScroll?: boolean) => void;
} {
  let storedElement: HTMLElement | null = null;

  return {
    save() {
      storedElement = document.activeElement as HTMLElement;
    },
    restore(preventScroll = false) {
      if (storedElement && isElementVisible(storedElement)) {
        storedElement.focus({ preventScroll });
      }
    },
  };
}
