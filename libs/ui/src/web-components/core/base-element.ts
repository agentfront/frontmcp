/**
 * @file base-element.ts
 * @description Base class for all FrontMCP Web Components.
 *
 * Provides a foundation for creating Custom Elements with:
 * - Zod schema validation
 * - Attribute-to-option mapping
 * - Property setters for React/Vue compatibility
 * - Batched rendering via queueMicrotask
 * - Light DOM (no Shadow DOM) for Tailwind compatibility
 *
 * @example Creating a custom element
 * ```typescript
 * import { FmcpElement } from '@frontmcp/ui/web-components';
 * import { ButtonOptionsSchema, type ButtonOptions } from '@frontmcp/ui/components';
 * import { button } from '@frontmcp/ui/components';
 *
 * class FmcpButton extends FmcpElement<ButtonOptions> {
 *   protected readonly config = {
 *     name: 'button',
 *     schema: ButtonOptionsSchema,
 *     defaults: { variant: 'primary', size: 'md' },
 *   };
 *
 *   static get observedAttributes() {
 *     return getObservedAttributesFromSchema(ButtonOptionsSchema);
 *   }
 *
 *   protected renderHtml(options: ButtonOptions, content: string): string {
 *     return button(content, options);
 *   }
 * }
 *
 * customElements.define('fmcp-button', FmcpButton);
 * ```
 *
 * @module @frontmcp/ui/web-components/core/base-element
 */

import type { ZodSchema } from 'zod';
import { validationErrorBox } from '../../validation/error-box';
import { parseAttributeValue, mergeAttributeIntoOptions } from './attribute-parser';

// Server-side stub for HTMLElement (Node.js doesn't have DOM)
// This allows the module to be imported without errors, but the actual
// web components can only be used in browser environments.
const HTMLElementBase =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {
        innerHTML = '';
        dispatchEvent() {
          return true;
        }
        getAttribute() {
          return null;
        }
      } as unknown as typeof HTMLElement);

/**
 * Configuration for FmcpElement subclasses
 */
export interface FmcpElementConfig<TOptions> {
  /** Component name (used in error messages) */
  name: string;
  /** Zod schema for validation */
  schema: ZodSchema<TOptions>;
  /** Default option values */
  defaults?: Partial<TOptions>;
}

/**
 * Custom event detail for fmcp:render event
 */
export interface FmcpRenderEventDetail<TOptions = unknown> {
  options: TOptions;
}

/**
 * Base class for all FrontMCP Web Components.
 *
 * Key features:
 * - **Light DOM**: Renders directly to innerHTML (no Shadow DOM)
 * - **Attribute Parsing**: Converts HTML attributes to typed options
 * - **Property Setters**: React/Vue can set properties directly
 * - **Zod Validation**: Invalid options render error box
 * - **Batched Rendering**: Multiple changes batch via queueMicrotask
 * - **HTMX Support**: hx-* attributes pass through to inner elements
 *
 * @typeParam TOptions - The component's options type (from Zod schema)
 *
 * @example Usage in HTML
 * ```html
 * <fmcp-button variant="primary" disabled>
 *   Click Me
 * </fmcp-button>
 * ```
 *
 * @example Usage in React
 * ```tsx
 * <fmcp-button
 *   variant="primary"
 *   onClick={handleClick}
 * >
 *   Click Me
 * </fmcp-button>
 * ```
 */
export abstract class FmcpElement<TOptions> extends HTMLElementBase {
  /**
   * Configuration provided by subclass.
   * Must include component name, Zod schema, and optional defaults.
   */
  protected abstract readonly config: FmcpElementConfig<TOptions>;

  /** Internal options state */
  protected _options: Partial<TOptions> = {};

  /** Content passed as children (captured on connect) */
  protected _content: string = '';

  /** Whether component has been connected to DOM */
  private _connected = false;

  /** Whether a render is pending (for batching) */
  private _pendingRender = false;

  /** Whether initial render has completed */
  private _initialRenderComplete = false;

  // ============================================
  // Lifecycle Callbacks
  // ============================================

  /**
   * Called when element is added to DOM.
   * Captures content, parses attributes, and renders.
   *
   * Supports SSR hydration via `data-ssr` attribute:
   * - If `data-ssr` is present, content was pre-rendered by server
   * - Web component adopts existing content without re-rendering
   * - This enables progressive enhancement for LLM platforms
   */
  connectedCallback(): void {
    this._connected = true;

    // Check for SSR hydration marker
    const isHydrating = this.hasAttribute('data-ssr');

    if (isHydrating) {
      // Content already rendered by server, adopt it
      this._content = this.innerHTML;
      this._initialRenderComplete = true;
      this.removeAttribute('data-ssr');
      // Parse attributes for property access (but don't re-render)
      this._parseAttributes();
      return;
    }

    // Normal client-side rendering path
    // Capture initial content before first render
    // (so we can use it as the component's text/children)
    if (!this._initialRenderComplete) {
      this._content = this.innerHTML;
    }

    // Parse all current attributes into options
    this._parseAttributes();

    // Initial render
    this._render();
  }

  /**
   * Called when element is removed from DOM.
   */
  disconnectedCallback(): void {
    this._connected = false;
  }

  /**
   * Called when an observed attribute changes.
   * Updates options and schedules re-render.
   */
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    // Skip if value unchanged
    if (oldValue === newValue) return;

    // Update the corresponding option
    this._updateOptionFromAttribute(name, newValue);

    // Schedule re-render (batched)
    this._scheduleRender();
  }

  // ============================================
  // Property Accessors (React/Vue Compatibility)
  // ============================================

  /**
   * Set all options at once (React pattern).
   *
   * @example
   * ```typescript
   * const el = document.querySelector('fmcp-button');
   * el.options = { variant: 'danger', size: 'lg' };
   * ```
   */
  set options(value: Partial<TOptions>) {
    this._options = { ...this._options, ...value };
    this._scheduleRender();
  }

  /**
   * Get current options.
   */
  get options(): Partial<TOptions> {
    return { ...this._options };
  }

  // ============================================
  // Attribute Parsing
  // ============================================

  /**
   * Parse all current attributes into options.
   */
  private _parseAttributes(): void {
    for (const attr of Array.from(this.attributes)) {
      this._updateOptionFromAttribute(attr.name, attr.value);
    }
  }

  /**
   * Update a single option from an attribute change.
   */
  private _updateOptionFromAttribute(attrName: string, value: string | null): void {
    const parsed = parseAttributeValue(attrName, value);
    this._options = mergeAttributeIntoOptions(this._options, parsed);
  }

  // ============================================
  // Rendering
  // ============================================

  /**
   * Schedule a render on next microtask.
   * Batches multiple attribute/property changes.
   */
  protected _scheduleRender(): void {
    if (!this._connected || this._pendingRender) return;

    this._pendingRender = true;
    queueMicrotask(() => {
      this._pendingRender = false;
      if (this._connected) {
        this._render();
      }
    });
  }

  /**
   * Perform the actual render.
   * Validates options and updates innerHTML.
   */
  private _render(): void {
    // Merge defaults with current options
    const mergedOptions = {
      ...this.config.defaults,
      ...this._options,
    } as TOptions;

    // Validate with Zod schema
    const result = this.config.schema.safeParse(mergedOptions);

    if (!result.success) {
      // Render validation error box
      const firstError = result.error.issues[0];
      const invalidParam = firstError?.path.join('.') || 'options';

      this.innerHTML = validationErrorBox({
        componentName: this.config.name,
        invalidParam,
      });

      this._initialRenderComplete = true;
      return;
    }

    // Generate HTML using subclass implementation
    const html = this.renderHtml(result.data, this._content);

    // Update Light DOM
    this.innerHTML = html;

    this._initialRenderComplete = true;

    // Dispatch render event for debugging/testing
    this.dispatchEvent(
      new CustomEvent<FmcpRenderEventDetail<TOptions>>('fmcp:render', {
        bubbles: true,
        detail: { options: result.data },
      }),
    );
  }

  /**
   * Generate HTML for the component.
   * Subclasses must implement this to render their specific HTML.
   *
   * @param options - Validated options
   * @param content - Original innerHTML content
   * @returns HTML string to render
   */
  protected abstract renderHtml(options: TOptions, content: string): string;

  // ============================================
  // Public API
  // ============================================

  /**
   * Force an immediate re-render.
   *
   * @example
   * ```typescript
   * el.options = { loading: true };
   * el.refresh(); // Force immediate render
   * ```
   */
  public refresh(): void {
    if (this._connected) {
      this._render();
    }
  }

  /**
   * Get the first child element (the actual rendered component).
   *
   * @typeParam T - Expected element type
   * @returns The first child element or null
   *
   * @example
   * ```typescript
   * const button = el.getInnerElement<HTMLButtonElement>();
   * button?.focus();
   * ```
   */
  public getInnerElement<T extends Element = Element>(): T | null {
    return this.firstElementChild as T | null;
  }

  /**
   * Update content and re-render.
   *
   * @param content - New content string
   */
  public setContent(content: string): void {
    this._content = content;
    this._scheduleRender();
  }
}
