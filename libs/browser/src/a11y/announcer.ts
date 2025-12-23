// file: libs/browser/src/a11y/announcer.ts
/**
 * Screen Reader Announcer
 *
 * Utilities for announcing messages to screen readers via ARIA live regions.
 */

import type { AriaLive } from './aria-helpers';

/**
 * Announcer instance interface
 */
export interface Announcer {
  /** Announce a message politely */
  announce: (message: string) => void;
  /** Announce a message assertively (interrupts) */
  announceAssertive: (message: string) => void;
  /** Clear current announcement */
  clear: () => void;
  /** Destroy the announcer and remove DOM elements */
  destroy: () => void;
}

/**
 * Announcer options
 */
export interface AnnouncerOptions {
  /** Container to append live regions to (defaults to document.body) */
  container?: HTMLElement;
  /** Delay before clearing announcement (ms, 0 = never clear) */
  clearDelay?: number;
  /** Custom CSS class for the announcer container */
  className?: string;
}

/**
 * Create visually hidden styles for screen reader only content
 */
function createVisuallyHiddenStyles(): Partial<CSSStyleDeclaration> {
  return {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: '0',
  };
}

/**
 * Create an announcer for screen reader announcements
 *
 * @example
 * ```tsx
 * const announcer = createAnnouncer();
 *
 * // Polite announcement (queued)
 * announcer.announce('Item added to cart');
 *
 * // Assertive announcement (interrupts)
 * announcer.announceAssertive('Error: Form submission failed');
 *
 * // Cleanup when done
 * announcer.destroy();
 * ```
 */
export function createAnnouncer(options: AnnouncerOptions = {}): Announcer {
  const container = options.container ?? document.body;
  const clearDelay = options.clearDelay ?? 5000;

  // Create container element
  const wrapper = document.createElement('div');
  wrapper.className = options.className ?? 'frontmcp-announcer';
  Object.assign(wrapper.style, createVisuallyHiddenStyles());
  wrapper.setAttribute('aria-live', 'off');

  // Create polite region
  const politeRegion = document.createElement('div');
  politeRegion.setAttribute('role', 'status');
  politeRegion.setAttribute('aria-live', 'polite');
  politeRegion.setAttribute('aria-atomic', 'true');

  // Create assertive region
  const assertiveRegion = document.createElement('div');
  assertiveRegion.setAttribute('role', 'alert');
  assertiveRegion.setAttribute('aria-live', 'assertive');
  assertiveRegion.setAttribute('aria-atomic', 'true');

  wrapper.appendChild(politeRegion);
  wrapper.appendChild(assertiveRegion);
  container.appendChild(wrapper);

  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  const announce = (message: string, region: HTMLElement) => {
    // Clear any pending timer
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }

    // Clear and set message (forces screen reader to re-read)
    region.textContent = '';

    // Use requestAnimationFrame to ensure the clear is processed
    requestAnimationFrame(() => {
      region.textContent = message;
    });

    // Schedule clear if delay is set
    if (clearDelay > 0) {
      clearTimer = setTimeout(() => {
        region.textContent = '';
      }, clearDelay);
    }
  };

  return {
    announce(message: string) {
      announce(message, politeRegion);
    },

    announceAssertive(message: string) {
      announce(message, assertiveRegion);
    },

    clear() {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      politeRegion.textContent = '';
      assertiveRegion.textContent = '';
    },

    destroy() {
      if (clearTimer) {
        clearTimeout(clearTimer);
      }
      wrapper.remove();
    },
  };
}

/**
 * Global announcer singleton
 */
let globalAnnouncer: Announcer | null = null;

/**
 * Get or create the global announcer
 */
export function getGlobalAnnouncer(): Announcer {
  if (!globalAnnouncer) {
    globalAnnouncer = createAnnouncer();
  }
  return globalAnnouncer;
}

/**
 * Announce a message politely using the global announcer
 *
 * @example
 * ```tsx
 * import { announce } from '@frontmcp/browser/a11y';
 *
 * function handleSave() {
 *   await saveData();
 *   announce('Changes saved successfully');
 * }
 * ```
 */
export function announce(message: string): void {
  getGlobalAnnouncer().announce(message);
}

/**
 * Announce a message assertively using the global announcer
 *
 * @example
 * ```tsx
 * import { announceAssertive } from '@frontmcp/browser/a11y';
 *
 * function handleError(error: Error) {
 *   announceAssertive(`Error: ${error.message}`);
 * }
 * ```
 */
export function announceAssertive(message: string): void {
  getGlobalAnnouncer().announceAssertive(message);
}

/**
 * React hook for announcements
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { announce, announceAssertive } = useAnnouncer();
 *
 *   const handleClick = () => {
 *     announce('Button clicked');
 *   };
 *
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useAnnouncer(): {
  announce: (message: string) => void;
  announceAssertive: (message: string) => void;
} {
  return {
    announce,
    announceAssertive,
  };
}

/**
 * Create a visual announcer that also shows messages on screen
 */
export interface VisualAnnouncerOptions extends AnnouncerOptions {
  /** Duration to show message (ms) */
  displayDuration?: number;
  /** Position on screen */
  position?: 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Z-index for the visual element */
  zIndex?: number;
}

export interface VisualAnnouncer extends Announcer {
  /** Show a visual message (in addition to announcing) */
  showMessage: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Create a visual announcer that shows messages on screen
 *
 * @example
 * ```tsx
 * const announcer = createVisualAnnouncer({
 *   position: 'bottom-right',
 *   displayDuration: 3000,
 * });
 *
 * announcer.showMessage('File uploaded', 'success');
 * ```
 */
export function createVisualAnnouncer(options: VisualAnnouncerOptions = {}): VisualAnnouncer {
  const baseAnnouncer = createAnnouncer(options);
  const displayDuration = options.displayDuration ?? 3000;
  const position = options.position ?? 'bottom';
  const zIndex = options.zIndex ?? 9999;

  // Create visual container
  const visualContainer = document.createElement('div');
  visualContainer.className = 'frontmcp-visual-announcer';
  visualContainer.setAttribute('aria-hidden', 'true'); // Already announced via live region

  // Position styles
  const positionStyles: Record<string, Partial<CSSStyleDeclaration>> = {
    top: { top: '16px', left: '50%', transform: 'translateX(-50%)' },
    bottom: { bottom: '16px', left: '50%', transform: 'translateX(-50%)' },
    'top-left': { top: '16px', left: '16px' },
    'top-right': { top: '16px', right: '16px' },
    'bottom-left': { bottom: '16px', left: '16px' },
    'bottom-right': { bottom: '16px', right: '16px' },
  };

  Object.assign(visualContainer.style, {
    position: 'fixed',
    zIndex: String(zIndex),
    maxWidth: '400px',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '14px',
    backgroundColor: '#1f2937',
    color: '#f3f4f6',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    opacity: '0',
    transition: 'opacity 200ms ease-in-out',
    pointerEvents: 'none',
    ...positionStyles[position],
  });

  document.body.appendChild(visualContainer);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const showMessage = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (hideTimer) {
      clearTimeout(hideTimer);
    }

    // Type colors
    const typeColors = {
      info: '#3b82f6',
      success: '#22c55e',
      warning: '#eab308',
      error: '#ef4444',
    };

    visualContainer.textContent = message;
    visualContainer.style.borderLeft = `4px solid ${typeColors[type]}`;
    visualContainer.style.opacity = '1';

    // Also announce for screen readers
    if (type === 'error') {
      baseAnnouncer.announceAssertive(message);
    } else {
      baseAnnouncer.announce(message);
    }

    hideTimer = setTimeout(() => {
      visualContainer.style.opacity = '0';
    }, displayDuration);
  };

  return {
    ...baseAnnouncer,
    showMessage,
    destroy() {
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
      visualContainer.remove();
      baseAnnouncer.destroy();
    },
  };
}
