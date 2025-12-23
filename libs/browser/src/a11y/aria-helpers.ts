// file: libs/browser/src/a11y/aria-helpers.ts
/**
 * ARIA Helper Utilities
 *
 * Utilities for managing ARIA attributes and roles.
 */

/**
 * Generate a unique ID for ARIA relationships
 */
export function generateAriaId(prefix = 'aria'): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * ARIA live region politeness
 */
export type AriaLive = 'off' | 'polite' | 'assertive';

/**
 * ARIA role values
 */
export type AriaRole =
  | 'alert'
  | 'alertdialog'
  | 'application'
  | 'article'
  | 'banner'
  | 'button'
  | 'checkbox'
  | 'columnheader'
  | 'combobox'
  | 'complementary'
  | 'contentinfo'
  | 'dialog'
  | 'directory'
  | 'document'
  | 'feed'
  | 'figure'
  | 'form'
  | 'grid'
  | 'gridcell'
  | 'group'
  | 'heading'
  | 'img'
  | 'link'
  | 'list'
  | 'listbox'
  | 'listitem'
  | 'log'
  | 'main'
  | 'marquee'
  | 'math'
  | 'menu'
  | 'menubar'
  | 'menuitem'
  | 'menuitemcheckbox'
  | 'menuitemradio'
  | 'navigation'
  | 'none'
  | 'note'
  | 'option'
  | 'presentation'
  | 'progressbar'
  | 'radio'
  | 'radiogroup'
  | 'region'
  | 'row'
  | 'rowgroup'
  | 'rowheader'
  | 'scrollbar'
  | 'search'
  | 'searchbox'
  | 'separator'
  | 'slider'
  | 'spinbutton'
  | 'status'
  | 'switch'
  | 'tab'
  | 'table'
  | 'tablist'
  | 'tabpanel'
  | 'term'
  | 'textbox'
  | 'timer'
  | 'toolbar'
  | 'tooltip'
  | 'tree'
  | 'treegrid'
  | 'treeitem';

/**
 * Common ARIA attribute helpers
 */
export interface AriaAttributes {
  // Relationship attributes
  'aria-describedby'?: string;
  'aria-labelledby'?: string;
  'aria-controls'?: string;
  'aria-owns'?: string;
  'aria-flowto'?: string;
  'aria-details'?: string;
  'aria-errormessage'?: string;

  // State attributes
  'aria-busy'?: boolean;
  'aria-checked'?: boolean | 'mixed';
  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time';
  'aria-disabled'?: boolean;
  'aria-expanded'?: boolean;
  'aria-hidden'?: boolean;
  'aria-invalid'?: boolean | 'grammar' | 'spelling';
  'aria-pressed'?: boolean | 'mixed';
  'aria-selected'?: boolean;

  // Property attributes
  'aria-label'?: string;
  'aria-level'?: number;
  'aria-modal'?: boolean;
  'aria-multiline'?: boolean;
  'aria-multiselectable'?: boolean;
  'aria-orientation'?: 'horizontal' | 'vertical';
  'aria-placeholder'?: string;
  'aria-readonly'?: boolean;
  'aria-required'?: boolean;
  'aria-sort'?: 'none' | 'ascending' | 'descending' | 'other';
  'aria-valuemax'?: number;
  'aria-valuemin'?: number;
  'aria-valuenow'?: number;
  'aria-valuetext'?: string;

  // Live region attributes
  'aria-live'?: AriaLive;
  'aria-atomic'?: boolean;
  'aria-relevant'?: 'additions' | 'removals' | 'text' | 'all' | 'additions text';

  // Role
  role?: AriaRole;
}

/**
 * Build aria-describedby from multiple IDs
 */
export function ariaDescribedBy(...ids: (string | undefined | null)[]): string | undefined {
  const filtered = ids.filter(Boolean) as string[];
  return filtered.length > 0 ? filtered.join(' ') : undefined;
}

/**
 * Build aria-labelledby from multiple IDs
 */
export function ariaLabelledBy(...ids: (string | undefined | null)[]): string | undefined {
  const filtered = ids.filter(Boolean) as string[];
  return filtered.length > 0 ? filtered.join(' ') : undefined;
}

/**
 * Build aria-controls from multiple IDs
 */
export function ariaControls(...ids: (string | undefined | null)[]): string | undefined {
  const filtered = ids.filter(Boolean) as string[];
  return filtered.length > 0 ? filtered.join(' ') : undefined;
}

/**
 * Create ARIA props for a dialog
 */
export function dialogAriaProps(options: {
  titleId?: string;
  descriptionId?: string;
  isModal?: boolean;
}): AriaAttributes {
  return {
    role: 'dialog',
    'aria-modal': options.isModal ?? true,
    'aria-labelledby': options.titleId,
    'aria-describedby': options.descriptionId,
  };
}

/**
 * Create ARIA props for an alert dialog
 */
export function alertDialogAriaProps(options: { titleId?: string; descriptionId?: string }): AriaAttributes {
  return {
    role: 'alertdialog',
    'aria-modal': true,
    'aria-labelledby': options.titleId,
    'aria-describedby': options.descriptionId,
  };
}

/**
 * Create ARIA props for a menu
 */
export function menuAriaProps(options: {
  labelledBy?: string;
  label?: string;
  orientation?: 'horizontal' | 'vertical';
}): AriaAttributes {
  return {
    role: 'menu',
    'aria-labelledby': options.labelledBy,
    'aria-label': options.label,
    'aria-orientation': options.orientation ?? 'vertical',
  };
}

/**
 * Create ARIA props for a menu item
 */
export function menuItemAriaProps(options?: {
  disabled?: boolean;
  expanded?: boolean;
  hasPopup?: boolean;
}): AriaAttributes {
  return {
    role: 'menuitem',
    'aria-disabled': options?.disabled,
    'aria-expanded': options?.expanded,
  };
}

/**
 * Create ARIA props for a tab list
 */
export function tabListAriaProps(options?: {
  label?: string;
  labelledBy?: string;
  orientation?: 'horizontal' | 'vertical';
}): AriaAttributes {
  return {
    role: 'tablist',
    'aria-label': options?.label,
    'aria-labelledby': options?.labelledBy,
    'aria-orientation': options?.orientation ?? 'horizontal',
  };
}

/**
 * Create ARIA props for a tab
 */
export function tabAriaProps(options: { selected: boolean; controls: string; disabled?: boolean }): AriaAttributes {
  return {
    role: 'tab',
    'aria-selected': options.selected,
    'aria-controls': options.controls,
    'aria-disabled': options.disabled,
  };
}

/**
 * Create ARIA props for a tab panel
 */
export function tabPanelAriaProps(options: { labelledBy: string; hidden?: boolean }): AriaAttributes {
  return {
    role: 'tabpanel',
    'aria-labelledby': options.labelledBy,
    'aria-hidden': options.hidden,
  };
}

/**
 * Create ARIA props for a combobox
 */
export function comboboxAriaProps(options: {
  expanded: boolean;
  controls: string;
  autocomplete?: 'none' | 'list' | 'both' | 'inline';
  activeDescendant?: string;
  hasPopup?: 'listbox' | 'tree' | 'grid' | 'dialog';
}): Record<string, unknown> {
  return {
    role: 'combobox',
    'aria-expanded': options.expanded,
    'aria-controls': options.controls,
    'aria-autocomplete': options.autocomplete ?? 'list',
    'aria-activedescendant': options.activeDescendant,
    'aria-haspopup': options.hasPopup ?? 'listbox',
  };
}

/**
 * Create ARIA props for a listbox
 */
export function listboxAriaProps(options?: {
  label?: string;
  labelledBy?: string;
  multiselectable?: boolean;
  orientation?: 'horizontal' | 'vertical';
}): AriaAttributes {
  return {
    role: 'listbox',
    'aria-label': options?.label,
    'aria-labelledby': options?.labelledBy,
    'aria-multiselectable': options?.multiselectable,
    'aria-orientation': options?.orientation ?? 'vertical',
  };
}

/**
 * Create ARIA props for an option
 */
export function optionAriaProps(options: { selected: boolean; disabled?: boolean }): AriaAttributes {
  return {
    role: 'option',
    'aria-selected': options.selected,
    'aria-disabled': options.disabled,
  };
}

/**
 * Create ARIA props for a progress bar
 */
export function progressAriaProps(options: {
  value: number;
  min?: number;
  max?: number;
  valueText?: string;
  label?: string;
}): AriaAttributes {
  return {
    role: 'progressbar',
    'aria-valuenow': options.value,
    'aria-valuemin': options.min ?? 0,
    'aria-valuemax': options.max ?? 100,
    'aria-valuetext': options.valueText,
    'aria-label': options.label,
  };
}

/**
 * Create ARIA props for a slider
 */
export function sliderAriaProps(options: {
  value: number;
  min: number;
  max: number;
  step?: number;
  valueText?: string;
  label?: string;
  orientation?: 'horizontal' | 'vertical';
}): AriaAttributes {
  return {
    role: 'slider',
    'aria-valuenow': options.value,
    'aria-valuemin': options.min,
    'aria-valuemax': options.max,
    'aria-valuetext': options.valueText,
    'aria-label': options.label,
    'aria-orientation': options.orientation ?? 'horizontal',
  };
}
