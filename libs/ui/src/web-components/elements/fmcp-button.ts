/**
 * @file fmcp-button.ts
 * @description FrontMCP Button Web Component.
 *
 * A custom element wrapper around the button() HTML function.
 * Works natively in React, Vue, Angular, and plain HTML.
 *
 * @example Basic usage
 * ```html
 * <fmcp-button>Click Me</fmcp-button>
 * <fmcp-button variant="danger">Delete</fmcp-button>
 * <fmcp-button disabled>Disabled</fmcp-button>
 * ```
 *
 * @example With HTMX
 * ```html
 * <fmcp-button hx-post="/api/submit" hx-target="#result">
 *   Submit
 * </fmcp-button>
 * ```
 *
 * @example In React
 * ```tsx
 * import { registerFmcpButton } from '@frontmcp/ui/web-components';
 * registerFmcpButton();
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
 * @module @frontmcp/ui/web-components/elements/fmcp-button
 */

import { FmcpElement, type FmcpElementConfig, getObservedAttributesFromSchema } from '../core';
import { button, type ButtonOptions } from '../../components/button';
import { ButtonOptionsSchema } from '../../components/button.schema';

/**
 * FmcpButton Web Component
 *
 * Attributes:
 * - `variant` - 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'link'
 * - `size` - 'xs' | 'sm' | 'md' | 'lg' | 'xl'
 * - `type` - 'button' | 'submit' | 'reset'
 * - `disabled` - boolean (presence = true)
 * - `loading` - boolean
 * - `full-width` - boolean
 * - `icon-only` - boolean
 * - `href` - URL for link-style buttons
 * - `target` - '_blank' | '_self'
 * - `hx-get`, `hx-post`, etc. - HTMX attributes
 *
 * Properties (for React/Vue):
 * - All attributes can be set as properties
 * - `options` - Set all options at once
 *
 * Events:
 * - `fmcp:render` - Fired after render with { options } detail
 * - `fmcp:click` - Fired on button click with { options } detail
 */
export class FmcpButton extends FmcpElement<ButtonOptions> {
  protected readonly config: FmcpElementConfig<ButtonOptions> = {
    name: 'button',
    schema: ButtonOptionsSchema,
    defaults: {
      variant: 'primary',
      size: 'md',
      type: 'button',
    },
  };

  /**
   * Attributes to observe for changes.
   */
  static get observedAttributes(): string[] {
    return getObservedAttributesFromSchema(ButtonOptionsSchema);
  }

  /**
   * Render the button HTML using the button() function.
   */
  protected renderHtml(options: ButtonOptions, content: string): string {
    return button(content, options);
  }

  // ============================================
  // Property Setters (Individual Props)
  // ============================================

  set variant(value: ButtonOptions['variant']) {
    this._options.variant = value;
    this._scheduleRender();
  }
  get variant(): ButtonOptions['variant'] {
    return this._options.variant;
  }

  set size(value: ButtonOptions['size']) {
    this._options.size = value;
    this._scheduleRender();
  }
  get size(): ButtonOptions['size'] {
    return this._options.size;
  }

  set type(value: ButtonOptions['type']) {
    this._options.type = value;
    this._scheduleRender();
  }
  get type(): ButtonOptions['type'] {
    return this._options.type;
  }

  set disabled(value: boolean) {
    this._options.disabled = value;
    this._scheduleRender();
  }
  get disabled(): boolean {
    return this._options.disabled ?? false;
  }

  set loading(value: boolean) {
    this._options.loading = value;
    this._scheduleRender();
  }
  get loading(): boolean {
    return this._options.loading ?? false;
  }

  set fullWidth(value: boolean) {
    this._options.fullWidth = value;
    this._scheduleRender();
  }
  get fullWidth(): boolean {
    return this._options.fullWidth ?? false;
  }

  set iconOnly(value: boolean) {
    this._options.iconOnly = value;
    this._scheduleRender();
  }
  get iconOnly(): boolean {
    return this._options.iconOnly ?? false;
  }

  set iconBefore(value: string | undefined) {
    this._options.iconBefore = value;
    this._scheduleRender();
  }
  get iconBefore(): string | undefined {
    return this._options.iconBefore;
  }

  set iconAfter(value: string | undefined) {
    this._options.iconAfter = value;
    this._scheduleRender();
  }
  get iconAfter(): string | undefined {
    return this._options.iconAfter;
  }

  set href(value: string | undefined) {
    this._options.href = value;
    this._scheduleRender();
  }
  get href(): string | undefined {
    return this._options.href;
  }

  set buttonAriaLabel(value: string | undefined) {
    this._options.ariaLabel = value;
    this._scheduleRender();
  }
  get buttonAriaLabel(): string | undefined {
    return this._options.ariaLabel;
  }

  // ============================================
  // Event Forwarding
  // ============================================

  override connectedCallback(): void {
    super.connectedCallback();

    // Forward click events from inner button
    this.addEventListener('click', this._handleClick.bind(this));
  }

  private _handleClick(e: Event): void {
    // Only dispatch if click originated from inner button
    const innerButton = this.getInnerElement<HTMLButtonElement>();
    if (innerButton && (e.target === innerButton || innerButton.contains(e.target as Node))) {
      this.dispatchEvent(
        new CustomEvent('fmcp:click', {
          bubbles: true,
          detail: { options: this.options },
        }),
      );
    }
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Focus the inner button element.
   */
  public override focus(): void {
    const inner = this.getInnerElement<HTMLButtonElement>();
    inner?.focus();
  }

  /**
   * Blur the inner button element.
   */
  public override blur(): void {
    const inner = this.getInnerElement<HTMLButtonElement>();
    inner?.blur();
  }

  /**
   * Click the inner button programmatically.
   */
  public override click(): void {
    const inner = this.getInnerElement<HTMLButtonElement>();
    inner?.click();
  }
}

/**
 * Register the fmcp-button custom element.
 *
 * @example
 * ```typescript
 * import { registerFmcpButton } from '@frontmcp/ui/web-components';
 *
 * // Register once on app startup
 * registerFmcpButton();
 *
 * // Then use in HTML
 * // <fmcp-button variant="primary">Click</fmcp-button>
 * ```
 */
export function registerFmcpButton(): void {
  if (typeof customElements !== 'undefined' && !customElements.get('fmcp-button')) {
    customElements.define('fmcp-button', FmcpButton);
  }
}
