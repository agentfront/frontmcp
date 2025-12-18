/**
 * @file fmcp-input.ts
 * @description FrontMCP Input Web Component.
 *
 * A custom element wrapper around the input() HTML function.
 *
 * @example Basic usage
 * ```html
 * <fmcp-input name="email" type="email" label="Email Address"></fmcp-input>
 * <fmcp-input name="password" type="password" label="Password" required></fmcp-input>
 * ```
 *
 * @example With validation
 * ```html
 * <fmcp-input
 *   name="username"
 *   label="Username"
 *   helper="Choose a unique username"
 *   pattern="[a-z0-9]+"
 * ></fmcp-input>
 * ```
 *
 * @module @frontmcp/ui/web-components/elements/fmcp-input
 */

import { FmcpElement, type FmcpElementConfig, getObservedAttributesFromSchema } from '../core';
import { input, type InputOptions } from '../../components/form';
import { InputOptionsSchema } from '../../components/form.schema';

/**
 * FmcpInput Web Component
 */
export class FmcpInput extends FmcpElement<InputOptions> {
  protected readonly config: FmcpElementConfig<InputOptions> = {
    name: 'input',
    schema: InputOptionsSchema,
    defaults: {
      type: 'text',
      size: 'md',
      state: 'default',
    },
  };

  static get observedAttributes(): string[] {
    return [
      'name',
      'type',
      'id',
      'value',
      'placeholder',
      'label',
      'helper',
      'error',
      'size',
      'state',
      'required',
      'disabled',
      'readonly',
      'autocomplete',
      'pattern',
      'min',
      'max',
      'step',
      'class',
      'icon-before',
      'icon-after',
    ];
  }

  protected renderHtml(options: InputOptions, _content: string): string {
    return input(options);
  }

  // ============================================
  // Property Setters
  // ============================================

  set name(value: string) {
    this._options.name = value;
    this._scheduleRender();
  }
  get name(): string {
    return this._options.name ?? '';
  }

  set type(value: InputOptions['type']) {
    this._options.type = value;
    this._scheduleRender();
  }
  get type(): InputOptions['type'] {
    return this._options.type;
  }

  set label(value: string | undefined) {
    this._options.label = value;
    this._scheduleRender();
  }
  get label(): string | undefined {
    return this._options.label;
  }

  set placeholder(value: string | undefined) {
    this._options.placeholder = value;
    this._scheduleRender();
  }
  get placeholder(): string | undefined {
    return this._options.placeholder;
  }

  set helper(value: string | undefined) {
    this._options.helper = value;
    this._scheduleRender();
  }
  get helper(): string | undefined {
    return this._options.helper;
  }

  set error(value: string | undefined) {
    this._options.error = value;
    this._scheduleRender();
  }
  get error(): string | undefined {
    return this._options.error;
  }

  set size(value: InputOptions['size']) {
    this._options.size = value;
    this._scheduleRender();
  }
  get size(): InputOptions['size'] {
    return this._options.size;
  }

  set state(value: InputOptions['state']) {
    this._options.state = value;
    this._scheduleRender();
  }
  get state(): InputOptions['state'] {
    return this._options.state;
  }

  set required(value: boolean) {
    this._options.required = value;
    this._scheduleRender();
  }
  get required(): boolean {
    return this._options.required ?? false;
  }

  set disabled(value: boolean) {
    this._options.disabled = value;
    this._scheduleRender();
  }
  get disabled(): boolean {
    return this._options.disabled ?? false;
  }

  set readonly(value: boolean) {
    this._options.readonly = value;
    this._scheduleRender();
  }
  get readonly(): boolean {
    return this._options.readonly ?? false;
  }

  // ============================================
  // Form Integration
  // ============================================

  override connectedCallback(): void {
    super.connectedCallback();

    // Forward input/change events
    this.addEventListener('input', this._handleInput.bind(this));
    this.addEventListener('change', this._handleChange.bind(this));
  }

  private _handleInput(e: Event): void {
    const inputEl = this.querySelector('input');
    if (inputEl && (e.target === inputEl || inputEl.contains(e.target as Node))) {
      this.dispatchEvent(
        new CustomEvent('fmcp:input', {
          bubbles: true,
          detail: { value: inputEl.value, name: this._options.name },
        }),
      );
    }
  }

  private _handleChange(e: Event): void {
    const inputEl = this.querySelector('input');
    if (inputEl && (e.target === inputEl || inputEl.contains(e.target as Node))) {
      this.dispatchEvent(
        new CustomEvent('fmcp:change', {
          bubbles: true,
          detail: { value: inputEl.value, name: this._options.name },
        }),
      );
    }
  }

  /**
   * Get current input value.
   */
  get value(): string {
    const inputEl = this.querySelector('input');
    return inputEl?.value ?? this._options.value ?? '';
  }

  /**
   * Set input value.
   */
  set value(val: string) {
    const inputEl = this.querySelector('input');
    if (inputEl) {
      inputEl.value = val;
    }
    this._options.value = val;
  }

  /**
   * Get validity state.
   */
  get validity(): ValidityState | undefined {
    return this.querySelector('input')?.validity;
  }

  /**
   * Check validity.
   */
  checkValidity(): boolean {
    return this.querySelector('input')?.checkValidity() ?? true;
  }

  /**
   * Report validity.
   */
  reportValidity(): boolean {
    return this.querySelector('input')?.reportValidity() ?? true;
  }

  /**
   * Focus the input.
   */
  override focus(): void {
    this.querySelector('input')?.focus();
  }

  /**
   * Blur the input.
   */
  override blur(): void {
    this.querySelector('input')?.blur();
  }

  /**
   * Select all text.
   */
  select(): void {
    this.querySelector('input')?.select();
  }
}

/**
 * Register the fmcp-input custom element.
 */
export function registerFmcpInput(): void {
  if (typeof customElements !== 'undefined' && !customElements.get('fmcp-input')) {
    customElements.define('fmcp-input', FmcpInput);
  }
}
