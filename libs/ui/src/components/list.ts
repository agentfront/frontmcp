/**
 * List Components
 *
 * Various list presentations including permission lists, feature lists, and data lists.
 */

import { escapeHtml } from '../layouts/base';

// ============================================
// List Item Types
// ============================================

/**
 * Permission/Scope item for OAuth consent
 */
export interface PermissionItem {
  /** Scope identifier */
  scope: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** Icon HTML */
  icon?: string;
  /** Required permission (cannot be unchecked) */
  required?: boolean;
  /** Checked by default */
  checked?: boolean;
  /** Sensitive/dangerous permission */
  sensitive?: boolean;
}

/**
 * Feature list item
 */
export interface FeatureItem {
  /** Feature name */
  name: string;
  /** Feature description */
  description?: string;
  /** Icon HTML */
  icon?: string;
  /** Included in plan */
  included?: boolean;
}

/**
 * Description list item
 */
export interface DescriptionItem {
  /** Term/label */
  term: string;
  /** Description/value */
  description: string;
  /** Copy button */
  copyable?: boolean;
}

// ============================================
// Permission List (for OAuth consent)
// ============================================

/**
 * Permission list options
 */
export interface PermissionListOptions {
  /** List ID */
  id?: string;
  /** Checkable permissions */
  checkable?: boolean;
  /** Input name for checkable */
  inputName?: string;
  /** Group title */
  title?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Default permission icons
 */
const permissionIcons: Record<string, string> = {
  read: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
  </svg>`,
  write: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
  </svg>`,
  delete: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
  </svg>`,
  profile: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
  </svg>`,
  email: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
  </svg>`,
  settings: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
  </svg>`,
  default: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
  </svg>`,
};

/**
 * Get icon for permission type
 */
function getPermissionIcon(scope: string, customIcon?: string): string {
  if (customIcon) return customIcon;

  const scopeLower = scope.toLowerCase();
  if (scopeLower.includes('read')) return permissionIcons['read'];
  if (scopeLower.includes('write') || scopeLower.includes('create') || scopeLower.includes('update'))
    return permissionIcons['write'];
  if (scopeLower.includes('delete')) return permissionIcons['delete'];
  if (scopeLower.includes('profile')) return permissionIcons['profile'];
  if (scopeLower.includes('email')) return permissionIcons['email'];
  if (scopeLower.includes('settings') || scopeLower.includes('config')) return permissionIcons['settings'];

  return permissionIcons['default'];
}

/**
 * Build a permission list for OAuth consent
 */
export function permissionList(permissions: PermissionItem[], options: PermissionListOptions = {}): string {
  const { id, checkable = false, inputName = 'scopes', title, className = '' } = options;

  const titleHtml = title ? `<h4 class="font-medium text-text-primary mb-3">${escapeHtml(title)}</h4>` : '';

  const itemsHtml = permissions
    .map((perm, index) => {
      const icon = getPermissionIcon(perm.scope, perm.icon);
      const sensitiveClasses = perm.sensitive ? 'border-warning/30 bg-warning/5' : 'border-border';
      const sensitiveLabel = perm.sensitive
        ? '<span class="text-xs text-warning font-medium ml-2">Sensitive</span>'
        : '';

      const checkboxHtml = checkable
        ? `<input
          type="checkbox"
          name="${escapeHtml(inputName)}[]"
          value="${escapeHtml(perm.scope)}"
          class="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
          ${perm.checked || perm.required ? 'checked' : ''}
          ${perm.required ? 'disabled' : ''}
          id="${id ? escapeHtml(id) : 'perm'}-${index}"
        >`
        : `<div class="w-5 h-5 rounded-full bg-success/10 text-success flex items-center justify-center">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
          </svg>
        </div>`;

      return `<div class="flex items-start gap-3 p-3 border ${sensitiveClasses} rounded-lg">
      <div class="flex-shrink-0 mt-0.5 text-text-secondary">
        ${icon}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center">
          <span class="font-medium text-text-primary">${escapeHtml(perm.name)}</span>
          ${perm.required ? '<span class="text-xs text-text-secondary ml-2">(Required)</span>' : ''}
          ${sensitiveLabel}
        </div>
        ${perm.description ? `<p class="text-sm text-text-secondary mt-0.5">${escapeHtml(perm.description)}</p>` : ''}
      </div>
      <div class="flex-shrink-0">
        ${checkboxHtml}
      </div>
    </div>`;
    })
    .join('\n');

  const idAttr = id ? `id="${escapeHtml(id)}"` : '';

  return `<div class="permission-list ${className}" ${idAttr}>
    ${titleHtml}
    <div class="space-y-2">
      ${itemsHtml}
    </div>
  </div>`;
}

// ============================================
// Feature List
// ============================================

/**
 * Feature list options
 */
export interface FeatureListOptions {
  /** List style */
  style?: 'check' | 'bullet' | 'number';
  /** Icon for included items */
  includedIcon?: string;
  /** Icon for excluded items */
  excludedIcon?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build a feature list
 */
export function featureList(features: FeatureItem[], options: FeatureListOptions = {}): string {
  const { style = 'check', includedIcon, excludedIcon, className = '' } = options;

  const defaultIncludedIcon = `<svg class="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
  </svg>`;

  const defaultExcludedIcon = `<svg class="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
  </svg>`;

  const itemsHtml = features
    .map((feature, index) => {
      const included = feature.included !== false;

      let iconHtml: string;
      if (style === 'check') {
        iconHtml = included ? includedIcon || defaultIncludedIcon : excludedIcon || defaultExcludedIcon;
      } else if (style === 'bullet') {
        iconHtml = `<span class="w-2 h-2 rounded-full ${included ? 'bg-primary' : 'bg-gray-300'}"></span>`;
      } else {
        iconHtml = `<span class="text-sm font-medium ${included ? 'text-primary' : 'text-gray-400'}">${
          index + 1
        }.</span>`;
      }

      const textClasses = included ? 'text-text-primary' : 'text-text-secondary line-through';

      return `<li class="flex items-start gap-3">
      <div class="flex-shrink-0 mt-0.5">${iconHtml}</div>
      <div class="flex-1">
        <span class="${textClasses}">${escapeHtml(feature.name)}</span>
        ${feature.description ? `<p class="text-sm text-text-secondary">${escapeHtml(feature.description)}</p>` : ''}
      </div>
    </li>`;
    })
    .join('\n');

  return `<ul class="space-y-3 ${className}">${itemsHtml}</ul>`;
}

// ============================================
// Description List
// ============================================

/**
 * Description list options
 */
export interface DescriptionListOptions {
  /** Layout style */
  layout?: 'stacked' | 'horizontal' | 'grid';
  /** Dividers between items */
  dividers?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build a description list
 */
export function descriptionList(items: DescriptionItem[], options: DescriptionListOptions = {}): string {
  const { layout = 'stacked', dividers = false, className = '' } = options;

  const copyScript = `
    <script>
      function copyToClipboard(text, btn) {
        navigator.clipboard.writeText(text).then(() => {
          const originalText = btn.innerHTML;
          btn.innerHTML = '<svg class="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
          setTimeout(() => btn.innerHTML = originalText, 2000);
        });
      }
    </script>
  `;

  const hasCopyable = items.some((item) => item.copyable);

  if (layout === 'horizontal') {
    const itemsHtml = items
      .map((item) => {
        const copyBtn = item.copyable
          ? `<button type="button" onclick="copyToClipboard('${escapeHtml(
              item.description,
            )}', this)" class="ml-2 p-1 rounded hover:bg-gray-100 transition-colors">
            <svg class="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
          </button>`
          : '';

        return `<div class="py-3 sm:grid sm:grid-cols-3 sm:gap-4 ${dividers ? 'border-b border-divider' : ''}">
        <dt class="text-sm font-medium text-text-secondary">${escapeHtml(item.term)}</dt>
        <dd class="mt-1 sm:mt-0 sm:col-span-2 text-sm text-text-primary flex items-center">
          ${escapeHtml(item.description)}
          ${copyBtn}
        </dd>
      </div>`;
      })
      .join('\n');

    return `<dl class="${className}">${itemsHtml}</dl>${hasCopyable ? copyScript : ''}`;
  }

  if (layout === 'grid') {
    const itemsHtml = items
      .map((item) => {
        const copyBtn = item.copyable
          ? `<button type="button" onclick="copyToClipboard('${escapeHtml(
              item.description,
            )}', this)" class="absolute top-2 right-2 p-1 rounded hover:bg-gray-100 transition-colors">
            <svg class="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
          </button>`
          : '';

        return `<div class="relative p-4 bg-gray-50 rounded-lg">
        <dt class="text-sm font-medium text-text-secondary">${escapeHtml(item.term)}</dt>
        <dd class="mt-1 text-sm text-text-primary font-medium">${escapeHtml(item.description)}</dd>
        ${copyBtn}
      </div>`;
      })
      .join('\n');

    return `<dl class="grid grid-cols-2 gap-4 ${className}">${itemsHtml}</dl>${hasCopyable ? copyScript : ''}`;
  }

  // Stacked layout (default)
  const itemsHtml = items
    .map((item) => {
      const copyBtn = item.copyable
        ? `<button type="button" onclick="copyToClipboard('${escapeHtml(
            item.description,
          )}', this)" class="ml-2 p-1 rounded hover:bg-gray-100 transition-colors">
          <svg class="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
        </button>`
        : '';

      return `<div class="${dividers ? 'py-3 border-b border-divider last:border-0' : 'py-2'}">
      <dt class="text-sm text-text-secondary">${escapeHtml(item.term)}</dt>
      <dd class="mt-1 text-sm text-text-primary font-medium flex items-center">
        ${escapeHtml(item.description)}
        ${copyBtn}
      </dd>
    </div>`;
    })
    .join('\n');

  return `<dl class="${className}">${itemsHtml}</dl>${hasCopyable ? copyScript : ''}`;
}

// ============================================
// Action List
// ============================================

/**
 * Action list item
 */
export interface ActionItem {
  /** Item label */
  label: string;
  /** Item description */
  description?: string;
  /** Icon HTML */
  icon?: string;
  /** Click URL */
  href?: string;
  /** HTMX attributes */
  htmx?: {
    get?: string;
    post?: string;
    target?: string;
    swap?: string;
  };
  /** Destructive action */
  destructive?: boolean;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Build an action list (menu-like)
 */
export function actionList(items: ActionItem[], className = ''): string {
  const itemsHtml = items
    .map((item) => {
      const baseClasses = [
        'flex items-center gap-3 px-4 py-3 transition-colors',
        item.disabled
          ? 'opacity-50 cursor-not-allowed'
          : item.destructive
          ? 'hover:bg-danger/5 text-danger cursor-pointer'
          : 'hover:bg-gray-50 cursor-pointer',
      ].join(' ');

      const iconHtml = item.icon
        ? `<span class="flex-shrink-0 ${item.destructive ? 'text-danger' : 'text-text-secondary'}">${item.icon}</span>`
        : '';

      const contentHtml = `
      ${iconHtml}
      <div class="flex-1 min-w-0">
        <div class="font-medium ${item.destructive ? 'text-danger' : 'text-text-primary'}">${escapeHtml(
        item.label,
      )}</div>
        ${item.description ? `<p class="text-sm text-text-secondary">${escapeHtml(item.description)}</p>` : ''}
      </div>
      <svg class="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
      </svg>
    `;

      if (item.disabled) {
        return `<div class="${baseClasses}">${contentHtml}</div>`;
      }

      const htmxAttrs: string[] = [];
      if (item.htmx) {
        if (item.htmx.get) htmxAttrs.push(`hx-get="${escapeHtml(item.htmx.get)}"`);
        if (item.htmx.post) htmxAttrs.push(`hx-post="${escapeHtml(item.htmx.post)}"`);
        if (item.htmx.target) htmxAttrs.push(`hx-target="${escapeHtml(item.htmx.target)}"`);
        if (item.htmx.swap) htmxAttrs.push(`hx-swap="${escapeHtml(item.htmx.swap)}"`);
      }

      if (item.href) {
        return `<a href="${escapeHtml(item.href)}" class="${baseClasses}" ${htmxAttrs.join(' ')}>${contentHtml}</a>`;
      }

      return `<div class="${baseClasses}" ${htmxAttrs.join(' ')}>${contentHtml}</div>`;
    })
    .join('\n');

  return `<div class="divide-y divide-divider ${className}">${itemsHtml}</div>`;
}
