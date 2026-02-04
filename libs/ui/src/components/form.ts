/**
 * Form Components
 *
 * Form elements including inputs, selects, textareas, and form layouts.
 */

import { escapeHtml } from '../layouts/base';
import { sanitizeHtmlContent } from '@frontmcp/uipack/runtime';

// ============================================
// Input Types
// ============================================

/**
 * Input type options
 */
export type InputType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'search'
  | 'date'
  | 'time'
  | 'datetime-local'
  | 'hidden';

/**
 * Input size options
 */
export type InputSize = 'sm' | 'md' | 'lg';

/**
 * Input state
 */
export type InputState = 'default' | 'error' | 'success' | 'warning';

// ============================================
// Form Field Options
// ============================================

/**
 * Base input options.
 *
 * **Security Note**: The `iconBefore` and `iconAfter` parameters accept raw HTML.
 * Do NOT pass untrusted user input without sanitization.
 * Use the `sanitize` option to automatically sanitize icon content.
 */
export interface InputOptions {
  /** Input type */
  type?: InputType;
  /** Input name */
  name: string;
  /** Input ID (defaults to name) */
  id?: string;
  /** Input value */
  value?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Label text (will be HTML-escaped) */
  label?: string;
  /** Helper text (will be HTML-escaped) */
  helper?: string;
  /** Error message (will be HTML-escaped) */
  error?: string;
  /** Input size */
  size?: InputSize;
  /** Input state */
  state?: InputState;
  /** Required field */
  required?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Readonly state */
  readonly?: boolean;
  /** Autocomplete attribute */
  autocomplete?: string;
  /** Pattern for validation */
  pattern?: string;
  /** Min value (for number/date) */
  min?: string | number;
  /** Max value (for number/date) */
  max?: string | number;
  /** Step value (for number) */
  step?: string | number;
  /** Additional CSS classes */
  className?: string;
  /** Data attributes */
  data?: Record<string, string>;
  /**
   * Icon before input (raw HTML, e.g., SVG).
   * **Warning**: Do not pass untrusted user input without sanitization.
   */
  iconBefore?: string;
  /**
   * Icon after input (raw HTML, e.g., SVG).
   * **Warning**: Do not pass untrusted user input without sanitization.
   */
  iconAfter?: string;
  /**
   * If true, sanitizes icon HTML content to prevent XSS.
   * @default false
   */
  sanitize?: boolean;
}

/**
 * Select options
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  selected?: boolean;
}

export interface SelectOptions
  extends Omit<InputOptions, 'type' | 'pattern' | 'min' | 'max' | 'step' | 'autocomplete'> {
  /** Select options */
  options: SelectOption[];
  /** Multiple selection */
  multiple?: boolean;
}

/**
 * Textarea options
 */
export interface TextareaOptions extends Omit<InputOptions, 'type' | 'pattern' | 'min' | 'max' | 'step'> {
  /** Number of rows */
  rows?: number;
  /** Resize behavior */
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

/**
 * Checkbox options
 */
export interface CheckboxOptions {
  /** Input name */
  name: string;
  /** Input ID */
  id?: string;
  /** Input value */
  value?: string;
  /** Label text */
  label: string;
  /** Checked state */
  checked?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Helper text */
  helper?: string;
  /** Error message */
  error?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Radio group options
 */
export interface RadioGroupOptions {
  /** Group name */
  name: string;
  /** Radio options */
  options: Array<{
    value: string;
    label: string;
    disabled?: boolean;
  }>;
  /** Selected value */
  value?: string;
  /** Label for the group */
  label?: string;
  /** Helper text */
  helper?: string;
  /** Error message */
  error?: string;
  /** Layout direction */
  direction?: 'horizontal' | 'vertical';
  /** Additional CSS classes */
  className?: string;
}

// ============================================
// Form Builders
// ============================================

/**
 * Get size classes for inputs
 */
function getInputSizeClasses(size: InputSize): string {
  const sizes: Record<InputSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-base',
  };
  return sizes[size];
}

/**
 * Get state classes for inputs
 */
function getInputStateClasses(state: InputState): string {
  const states: Record<InputState, string> = {
    default: 'border-border focus:border-primary focus:ring-primary/20',
    error: 'border-danger focus:border-danger focus:ring-danger/20',
    success: 'border-success focus:border-success focus:ring-success/20',
    warning: 'border-warning focus:border-warning focus:ring-warning/20',
  };
  return states[state];
}

/**
 * Build data attributes
 */
function buildDataAttrs(data?: Record<string, string>): string {
  if (!data) return '';
  return Object.entries(data)
    .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
    .join(' ');
}

/**
 * Build a text input component
 */
export function input(options: InputOptions): string {
  const {
    type = 'text',
    name,
    id = name,
    value = '',
    placeholder = '',
    label,
    helper,
    error,
    size = 'md',
    state = error ? 'error' : 'default',
    required = false,
    disabled = false,
    readonly = false,
    autocomplete,
    pattern,
    min,
    max,
    step,
    className = '',
    data,
    iconBefore,
    iconAfter,
    sanitize = false,
  } = options;

  // Sanitize icon HTML content if requested
  const safeIconBefore = sanitize && iconBefore ? sanitizeHtmlContent(iconBefore) : iconBefore;
  const safeIconAfter = sanitize && iconAfter ? sanitizeHtmlContent(iconAfter) : iconAfter;

  const sizeClasses = getInputSizeClasses(size);
  const stateClasses = getInputStateClasses(state);
  const hasIcon = safeIconBefore || safeIconAfter;

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  const baseClasses = [
    'w-full rounded-lg border bg-white',
    'transition-colors duration-200',
    'focus:outline-none focus:ring-2',
    disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : '',
    sizeClasses,
    stateClasses,
    hasIcon ? (safeIconBefore ? 'pl-10' : '') + (safeIconAfter ? ' pr-10' : '') : '',
    safeClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const dataAttrs = buildDataAttrs(data);

  const inputAttrs = [
    `type="${type}"`,
    `name="${escapeHtml(name)}"`,
    `id="${escapeHtml(id)}"`,
    value ? `value="${escapeHtml(value)}"` : '',
    placeholder ? `placeholder="${escapeHtml(placeholder)}"` : '',
    required ? 'required' : '',
    disabled ? 'disabled' : '',
    readonly ? 'readonly' : '',
    autocomplete ? `autocomplete="${escapeHtml(autocomplete)}"` : '',
    pattern ? `pattern="${escapeHtml(pattern)}"` : '',
    min !== undefined ? `min="${escapeHtml(String(min))}"` : '',
    max !== undefined ? `max="${escapeHtml(String(max))}"` : '',
    step !== undefined ? `step="${escapeHtml(String(step))}"` : '',
    `class="${baseClasses}"`,
    dataAttrs,
  ]
    .filter(Boolean)
    .join(' ');

  const labelHtml = label
    ? `<label for="${escapeHtml(id)}" class="block text-sm font-medium text-text-primary mb-1.5">
        ${escapeHtml(label)}${required ? '<span class="text-danger ml-1">*</span>' : ''}
      </label>`
    : '';

  const helperHtml = helper && !error ? `<p class="mt-1.5 text-sm text-text-secondary">${escapeHtml(helper)}</p>` : '';

  const errorHtml = error ? `<p class="mt-1.5 text-sm text-danger">${escapeHtml(error)}</p>` : '';

  const iconBeforeHtml = safeIconBefore
    ? `<span class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">${safeIconBefore}</span>`
    : '';

  const iconAfterHtml = safeIconAfter
    ? `<span class="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary">${safeIconAfter}</span>`
    : '';

  const inputHtml = hasIcon
    ? `<div class="relative">
        ${iconBeforeHtml}
        <input ${inputAttrs}>
        ${iconAfterHtml}
      </div>`
    : `<input ${inputAttrs}>`;

  return `<div class="form-field">
    ${labelHtml}
    ${inputHtml}
    ${helperHtml}
    ${errorHtml}
  </div>`;
}

/**
 * Build a select component
 */
export function select(options: SelectOptions): string {
  const {
    name,
    id = name,
    options: selectOptions,
    value,
    label,
    helper,
    error,
    size = 'md',
    state = error ? 'error' : 'default',
    required = false,
    disabled = false,
    multiple = false,
    className = '',
    data,
  } = options;

  const sizeClasses = getInputSizeClasses(size);
  const stateClasses = getInputStateClasses(state);

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  const baseClasses = [
    'w-full rounded-lg border bg-white',
    'transition-colors duration-200',
    'focus:outline-none focus:ring-2',
    disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : '',
    sizeClasses,
    stateClasses,
    safeClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const dataAttrs = buildDataAttrs(data);

  const optionsHtml = selectOptions
    .map((opt) => {
      const selected = opt.selected || opt.value === value ? 'selected' : '';
      const optDisabled = opt.disabled ? 'disabled' : '';
      return `<option value="${escapeHtml(opt.value)}" ${selected} ${optDisabled}>${escapeHtml(opt.label)}</option>`;
    })
    .join('\n');

  const labelHtml = label
    ? `<label for="${escapeHtml(id)}" class="block text-sm font-medium text-text-primary mb-1.5">
        ${escapeHtml(label)}${required ? '<span class="text-danger ml-1">*</span>' : ''}
      </label>`
    : '';

  const helperHtml = helper && !error ? `<p class="mt-1.5 text-sm text-text-secondary">${escapeHtml(helper)}</p>` : '';

  const errorHtml = error ? `<p class="mt-1.5 text-sm text-danger">${escapeHtml(error)}</p>` : '';

  return `<div class="form-field">
    ${labelHtml}
    <select
      name="${escapeHtml(name)}"
      id="${escapeHtml(id)}"
      class="${baseClasses}"
      ${required ? 'required' : ''}
      ${disabled ? 'disabled' : ''}
      ${multiple ? 'multiple' : ''}
      ${dataAttrs}
    >
      ${optionsHtml}
    </select>
    ${helperHtml}
    ${errorHtml}
  </div>`;
}

/**
 * Build a textarea component
 */
export function textarea(options: TextareaOptions): string {
  const {
    name,
    id = name,
    value = '',
    placeholder = '',
    label,
    helper,
    error,
    size = 'md',
    state = error ? 'error' : 'default',
    required = false,
    disabled = false,
    readonly = false,
    rows = 4,
    resize = 'vertical',
    className = '',
    data,
  } = options;

  const sizeClasses = getInputSizeClasses(size);
  const stateClasses = getInputStateClasses(state);

  const resizeClasses: Record<string, string> = {
    none: 'resize-none',
    vertical: 'resize-y',
    horizontal: 'resize-x',
    both: 'resize',
  };

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  const baseClasses = [
    'w-full rounded-lg border bg-white',
    'transition-colors duration-200',
    'focus:outline-none focus:ring-2',
    disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : '',
    sizeClasses,
    stateClasses,
    resizeClasses[resize],
    safeClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const dataAttrs = buildDataAttrs(data);

  const labelHtml = label
    ? `<label for="${escapeHtml(id)}" class="block text-sm font-medium text-text-primary mb-1.5">
        ${escapeHtml(label)}${required ? '<span class="text-danger ml-1">*</span>' : ''}
      </label>`
    : '';

  const helperHtml = helper && !error ? `<p class="mt-1.5 text-sm text-text-secondary">${escapeHtml(helper)}</p>` : '';

  const errorHtml = error ? `<p class="mt-1.5 text-sm text-danger">${escapeHtml(error)}</p>` : '';

  return `<div class="form-field">
    ${labelHtml}
    <textarea
      name="${escapeHtml(name)}"
      id="${escapeHtml(id)}"
      rows="${rows}"
      class="${baseClasses}"
      ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
      ${required ? 'required' : ''}
      ${disabled ? 'disabled' : ''}
      ${readonly ? 'readonly' : ''}
      ${dataAttrs}
    >${escapeHtml(value)}</textarea>
    ${helperHtml}
    ${errorHtml}
  </div>`;
}

/**
 * Build a checkbox component
 */
export function checkbox(options: CheckboxOptions): string {
  const {
    name,
    id = name,
    value = 'true',
    label,
    checked = false,
    disabled = false,
    helper,
    error,
    className = '',
  } = options;

  const checkboxClasses = [
    'h-4 w-4 rounded border-border text-primary',
    'focus:ring-2 focus:ring-primary/20 focus:ring-offset-0',
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
  ].join(' ');

  const helperHtml = helper && !error ? `<p class="text-sm text-text-secondary">${escapeHtml(helper)}</p>` : '';

  const errorHtml = error ? `<p class="text-sm text-danger">${escapeHtml(error)}</p>` : '';

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  return `<div class="form-field ${safeClassName}">
    <label class="flex items-start gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}">
      <input
        type="checkbox"
        name="${escapeHtml(name)}"
        id="${escapeHtml(id)}"
        value="${escapeHtml(value)}"
        class="${checkboxClasses}"
        ${checked ? 'checked' : ''}
        ${disabled ? 'disabled' : ''}
      >
      <div>
        <span class="text-sm font-medium text-text-primary">${escapeHtml(label)}</span>
        ${helperHtml}
        ${errorHtml}
      </div>
    </label>
  </div>`;
}

/**
 * Build a radio group component
 */
export function radioGroup(options: RadioGroupOptions): string {
  const { name, options: radioOptions, value, label, helper, error, direction = 'vertical', className = '' } = options;

  const directionClasses = direction === 'horizontal' ? 'flex flex-row flex-wrap gap-4' : 'flex flex-col gap-2';

  const radioClasses = 'h-4 w-4 border-border text-primary focus:ring-2 focus:ring-primary/20 focus:ring-offset-0';

  const radiosHtml = radioOptions
    .map((opt, index) => {
      const radioId = `${name}-${index}`;
      const checked = opt.value === value ? 'checked' : '';
      const disabled = opt.disabled ? 'disabled' : '';
      const cursorClass = opt.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer';

      return `<label class="flex items-center gap-2 ${cursorClass}">
        <input
          type="radio"
          name="${escapeHtml(name)}"
          id="${escapeHtml(radioId)}"
          value="${escapeHtml(opt.value)}"
          class="${radioClasses}"
          ${checked}
          ${disabled}
        >
        <span class="text-sm text-text-primary">${escapeHtml(opt.label)}</span>
      </label>`;
    })
    .join('\n');

  const labelHtml = label
    ? `<label class="block text-sm font-medium text-text-primary mb-2">${escapeHtml(label)}</label>`
    : '';

  const helperHtml = helper && !error ? `<p class="mt-1.5 text-sm text-text-secondary">${escapeHtml(helper)}</p>` : '';

  const errorHtml = error ? `<p class="mt-1.5 text-sm text-danger">${escapeHtml(error)}</p>` : '';

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  return `<div class="form-field ${safeClassName}" role="radiogroup">
    ${labelHtml}
    <div class="${directionClasses}">
      ${radiosHtml}
    </div>
    ${helperHtml}
    ${errorHtml}
  </div>`;
}

// ============================================
// Form Layout Components
// ============================================

/**
 * Form wrapper options
 */
export interface FormOptions {
  /** Form action URL */
  action?: string;
  /** HTTP method */
  method?: 'get' | 'post';
  /** Form ID */
  id?: string;
  /** Additional CSS classes */
  className?: string;
  /** Prevent default submission */
  preventDefault?: boolean;
  /** Autocomplete */
  autocomplete?: 'on' | 'off';
  /** Enctype for file uploads */
  enctype?: 'application/x-www-form-urlencoded' | 'multipart/form-data' | 'text/plain';
}

/**
 * Build form wrapper
 */
export function form(content: string, options: FormOptions = {}): string {
  const { action, method = 'post', id, className = '', preventDefault = false, autocomplete, enctype } = options;

  const attrs = [
    action ? `action="${escapeHtml(action)}"` : '',
    `method="${method}"`,
    id ? `id="${escapeHtml(id)}"` : '',
    className ? `class="${escapeHtml(className)}"` : '',
    autocomplete ? `autocomplete="${autocomplete}"` : '',
    enctype ? `enctype="${enctype}"` : '',
    preventDefault ? 'onsubmit="return false;"' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<form ${attrs}>${content}</form>`;
}

/**
 * Build form row (for horizontal forms)
 */
export function formRow(fields: string[], options: { gap?: 'sm' | 'md' | 'lg'; className?: string } = {}): string {
  const { gap = 'md', className = '' } = options;
  const gapClasses = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' };

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  return `<div class="grid grid-cols-${fields.length} ${gapClasses[gap]} ${safeClassName}">
    ${fields.join('\n')}
  </div>`;
}

/**
 * Build form section with title
 */
export function formSection(
  content: string,
  options: { title?: string; description?: string; className?: string } = {},
): string {
  const { title, description, className = '' } = options;

  const headerHtml = title
    ? `<div class="mb-4">
        <h3 class="text-lg font-semibold text-text-primary">${escapeHtml(title)}</h3>
        ${description ? `<p class="text-sm text-text-secondary mt-1">${escapeHtml(description)}</p>` : ''}
      </div>`
    : '';

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  return `<div class="form-section ${safeClassName}">
    ${headerHtml}
    <div class="space-y-4">
      ${content}
    </div>
  </div>`;
}

/**
 * Build form actions (submit/cancel buttons area)
 */
export function formActions(
  buttons: string[],
  options: { align?: 'left' | 'center' | 'right' | 'between'; className?: string } = {},
): string {
  const { align = 'right', className = '' } = options;

  const alignClasses: Record<string, string> = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
    between: 'justify-between',
  };

  // Escape className to prevent attribute injection
  const safeClassName = className ? escapeHtml(className) : '';
  return `<div class="flex items-center gap-3 pt-4 ${alignClasses[align]} ${safeClassName}">
    ${buttons.join('\n')}
  </div>`;
}

// ============================================
// Hidden Input
// ============================================

/**
 * Build a hidden input
 */
export function hiddenInput(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

/**
 * Build CSRF token hidden input
 */
export function csrfInput(token: string): string {
  return hiddenInput('_csrf', token);
}
