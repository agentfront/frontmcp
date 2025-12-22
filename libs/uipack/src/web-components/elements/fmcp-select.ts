/**
 * @file fmcp-select.ts
 * @description FrontMCP Select Web Component.
 *
 * A custom element wrapper around the select() HTML function.
 *
 * @example Basic usage
 * ```html
 * <fmcp-select name="country" label="Country" placeholder="Select a country">
 * </fmcp-select>
 * ```
 *
 * @example With options via property
 * ```tsx
 * const selectEl = document.querySelector('fmcp-select');
 * selectEl.selectOptions = [
 *   { value: 'us', label: 'United States' },
 *   { value: 'uk', label: 'United Kingdom' },
 * ];
 * ```
 *
 * @module @frontmcp/ui/web-components/elements/fmcp-select
 */

import { FmcpElement, type FmcpElementConfig, getObservedAttributesFromSchema } from '../core';
import { select, type SelectOptions } from '../../components/form';
import { SelectOptionsSchema, type SelectOptionItem } from '../../components/form.schema';

/**
 * FmcpSelect Web Component
 */
export class FmcpSelect extends FmcpElement<SelectOptions> {
  protected readonly config: FmcpElementConfig<SelectOptions> = {
    name: 'select',
    schema: SelectOptionsSchema,
    defaults: {
      size: 'md',
      state: 'default',
    },
  };

  /** Select options stored separately since they're complex objects */
  private _selectOptions: SelectOptionItem[] = [];

  static get observedAttributes(): string[] {
    return [
      'name',
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
      'multiple',
      'class',
    ];
  }

  protected renderHtml(options: SelectOptions, _content: string): string {
    // Merge stored select options
    const mergedOptions: SelectOptions = {
      ...options,
      options: this._selectOptions.length > 0 ? this._selectOptions : options.options,
    };
    return select(mergedOptions);
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

  set size(value: SelectOptions['size']) {
    this._options.size = value;
    this._scheduleRender();
  }
  get size(): SelectOptions['size'] {
    return this._options.size;
  }

  set state(value: SelectOptions['state']) {
    this._options.state = value;
    this._scheduleRender();
  }
  get state(): SelectOptions['state'] {
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

  set multiple(value: boolean) {
    this._options.multiple = value;
    this._scheduleRender();
  }
  get multiple(): boolean {
    return this._options.multiple ?? false;
  }

  /**
   * Set select options (array of { value, label, disabled?, selected? })
   */
  set selectOptions(value: SelectOptionItem[]) {
    this._selectOptions = value;
    this._scheduleRender();
  }
  get selectOptions(): SelectOptionItem[] {
    return this._selectOptions;
  }

  // ============================================
  // Form Integration
  // ============================================

  override connectedCallback(): void {
    super.connectedCallback();

    // Forward change events
    this.addEventListener('change', this._handleChange.bind(this));
  }

  private _handleChange(e: Event): void {
    const selectEl = this.querySelector('select');
    if (selectEl && (e.target === selectEl || selectEl.contains(e.target as Node))) {
      this.dispatchEvent(
        new CustomEvent('fmcp:change', {
          bubbles: true,
          detail: {
            value: selectEl.value,
            name: this._options.name,
            selectedOptions: Array.from(selectEl.selectedOptions).map((opt) => opt.value),
          },
        }),
      );
    }
  }

  /**
   * Get current select value.
   */
  get value(): string {
    const selectEl = this.querySelector('select');
    return selectEl?.value ?? this._options.value ?? '';
  }

  /**
   * Set select value.
   */
  set value(val: string) {
    const selectEl = this.querySelector('select');
    if (selectEl) {
      selectEl.value = val;
    }
    this._options.value = val;
  }

  /**
   * Get selected options (for multiple select).
   */
  get selectedOptions(): string[] {
    const selectEl = this.querySelector('select');
    return selectEl ? Array.from(selectEl.selectedOptions).map((opt) => opt.value) : [];
  }

  /**
   * Get validity state.
   */
  get validity(): ValidityState | undefined {
    return this.querySelector('select')?.validity;
  }

  /**
   * Check validity.
   */
  checkValidity(): boolean {
    return this.querySelector('select')?.checkValidity() ?? true;
  }

  /**
   * Report validity.
   */
  reportValidity(): boolean {
    return this.querySelector('select')?.reportValidity() ?? true;
  }

  /**
   * Focus the select.
   */
  override focus(): void {
    this.querySelector('select')?.focus();
  }

  /**
   * Blur the select.
   */
  override blur(): void {
    this.querySelector('select')?.blur();
  }
}

/**
 * Register the fmcp-select custom element.
 */
export function registerFmcpSelect(): void {
  if (typeof customElements !== 'undefined' && !customElements.get('fmcp-select')) {
    customElements.define('fmcp-select', FmcpSelect);
  }
}
