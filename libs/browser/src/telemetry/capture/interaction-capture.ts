// file: libs/browser/src/telemetry/capture/interaction-capture.ts
/**
 * Interaction Capture Module
 *
 * Captures user interaction events: clicks, inputs, form submissions.
 */

import type { CaptureModule, CaptureModuleOptions, TelemetryCategory, InteractionType } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Interaction capture options.
 */
export interface InteractionCaptureOptions extends CaptureModuleOptions {
  /** Event types to capture */
  events?: InteractionType[];

  /** CSS selector for elements to track */
  selector?: string;

  /** Whether to capture input values (sanitized) */
  captureValues?: boolean;

  /** Maximum value length to capture */
  maxValueLength?: number;

  /** Elements to ignore (CSS selectors) */
  ignore?: string[];
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_EVENTS: InteractionType[] = ['click', 'input', 'change', 'submit'];
const DEFAULT_MAX_VALUE_LENGTH = 100;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get a CSS selector path for an element.
 */
function getElementSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${current.id}`;
      parts.unshift(selector);
      break; // ID is unique, stop here
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 2);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/**
 * Check if element matches any ignore selector.
 */
function shouldIgnore(element: Element, ignoreSelectors: string[]): boolean {
  for (const selector of ignoreSelectors) {
    try {
      if (element.matches(selector)) return true;
      if (element.closest(selector)) return true;
    } catch {
      // Invalid selector
    }
  }
  return false;
}

/**
 * Sanitize input value.
 */
function sanitizeValue(value: string, maxLength: number): string {
  if (!value) return '';

  // Truncate
  let sanitized = value.slice(0, maxLength);

  // Remove potential PII indicators
  if (sanitized.includes('@') || /^\d{4}/.test(sanitized)) {
    sanitized = '[REDACTED]';
  }

  return sanitized;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an interaction capture module.
 */
export function createInteractionCapture(options: InteractionCaptureOptions): CaptureModule {
  const {
    collector,
    events = DEFAULT_EVENTS,
    selector,
    captureValues = false,
    maxValueLength = DEFAULT_MAX_VALUE_LENGTH,
    ignore = ['[data-telemetry-ignore]', '[type="password"]'],
    debug = false,
  } = options;

  let active = false;
  const handlers: Array<{ event: string; handler: EventListener }> = [];

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[InteractionCapture] ${message}`, data ?? '');
    }
  };

  // Create event handler
  const createHandler = (eventType: InteractionType): EventListener => {
    return (e: Event) => {
      const target = e.target as Element | null;
      if (!target) return;

      // Check ignore list
      if (shouldIgnore(target, ignore)) {
        log(`Ignored: ${eventType}`, target);
        return;
      }

      // Check selector
      if (selector && !target.matches(selector)) {
        return;
      }

      // Build event data
      const eventData: Record<string, unknown> = {
        category: 'interaction' as TelemetryCategory,
        type: eventType,
        target: getElementSelector(target),
        tagName: target.tagName.toLowerCase(),
      };

      if (target.id) {
        eventData['targetId'] = target.id;
      }

      if (target.className && typeof target.className === 'string') {
        eventData['targetClasses'] = target.className.trim().split(/\s+/);
      }

      // Capture value for input events
      if (captureValues && (eventType === 'input' || eventType === 'change')) {
        const inputElement = target as HTMLInputElement;
        if (inputElement.value && inputElement.type !== 'password') {
          eventData['value'] = sanitizeValue(inputElement.value, maxValueLength);
        }
      }

      // Capture position for click events
      if (eventType === 'click' && e instanceof MouseEvent) {
        eventData['position'] = { x: e.clientX, y: e.clientY };
      }

      collector.record(eventData as Parameters<typeof collector.record>[0]);
      log(`Captured: ${eventType}`, eventData);
    };
  };

  return {
    name: 'interaction',

    start(): void {
      if (active) return;
      if (typeof window === 'undefined') return;

      for (const eventType of events) {
        const handler = createHandler(eventType);
        document.addEventListener(eventType, handler, { capture: true, passive: true });
        handlers.push({ event: eventType, handler });
      }

      active = true;
      log('Started');
    },

    stop(): void {
      if (!active) return;

      for (const { event, handler } of handlers) {
        document.removeEventListener(event, handler, { capture: true } as EventListenerOptions);
      }
      handlers.length = 0;

      active = false;
      log('Stopped');
    },

    isActive(): boolean {
      return active;
    },

    dispose(): void {
      this.stop();
    },
  };
}
