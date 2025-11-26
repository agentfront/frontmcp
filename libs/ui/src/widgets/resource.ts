/**
 * OpenAI App SDK Resource Widgets
 *
 * Components for displaying resources in OpenAI's App SDK format.
 * These widgets are designed to work with OpenAI Canvas and similar interfaces.
 */

import { escapeHtml } from '../layouts/base';
import { card, type CardOptions } from '../components/card';
import { badge, type BadgeVariant } from '../components/badge';
import { button } from '../components/button';

// ============================================
// Resource Types
// ============================================

/**
 * Resource type identifiers
 */
export type ResourceType =
  | 'document'
  | 'image'
  | 'code'
  | 'data'
  | 'file'
  | 'link'
  | 'user'
  | 'event'
  | 'message'
  | 'task'
  | 'custom';

/**
 * Resource metadata
 */
export interface ResourceMeta {
  /** Creation timestamp */
  createdAt?: string | Date;
  /** Last modified timestamp */
  updatedAt?: string | Date;
  /** Author/creator */
  author?: string;
  /** File size (bytes) */
  size?: number;
  /** MIME type */
  mimeType?: string;
  /** Tags */
  tags?: string[];
  /** Custom metadata */
  [key: string]: unknown;
}

/**
 * Resource action
 */
export interface ResourceAction {
  /** Action label */
  label: string;
  /** Action icon */
  icon?: string;
  /** Action URL */
  href?: string;
  /** HTMX attributes */
  htmx?: {
    get?: string;
    post?: string;
    delete?: string;
    target?: string;
    swap?: string;
    confirm?: string;
  };
  /** Variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Disabled */
  disabled?: boolean;
}

/**
 * Base resource options
 */
export interface ResourceOptions {
  /** Resource type */
  type: ResourceType;
  /** Resource title */
  title: string;
  /** Resource description */
  description?: string;
  /** Resource icon */
  icon?: string;
  /** Resource thumbnail URL */
  thumbnail?: string;
  /** Resource URL */
  url?: string;
  /** Resource metadata */
  meta?: ResourceMeta;
  /** Resource status */
  status?: {
    label: string;
    variant: BadgeVariant;
  };
  /** Available actions */
  actions?: ResourceAction[];
  /** Additional CSS classes */
  className?: string;
  /** Card options */
  cardOptions?: Partial<CardOptions>;
}

// ============================================
// Resource Icons
// ============================================

const resourceIcons: Record<ResourceType, string> = {
  document: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
  </svg>`,
  image: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
  </svg>`,
  code: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
  </svg>`,
  data: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
  </svg>`,
  file: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
  </svg>`,
  link: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
  </svg>`,
  user: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
  </svg>`,
  event: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
  </svg>`,
  message: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
  </svg>`,
  task: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
  </svg>`,
  custom: `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
  </svg>`,
};

// ============================================
// Utility Functions
// ============================================

/**
 * Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format date
 */
function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================
// Resource Widget Builder
// ============================================

/**
 * Build a resource widget
 */
export function resourceWidget(options: ResourceOptions): string {
  const {
    type,
    title,
    description,
    icon,
    thumbnail,
    url,
    meta,
    status,
    actions = [],
    className = '',
    cardOptions = {},
  } = options;

  // Icon/Thumbnail
  const iconHtml = thumbnail
    ? `<div class="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
        <img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(title)}" class="w-full h-full object-cover">
      </div>`
    : `<div class="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-400">
        ${icon || resourceIcons[type]}
      </div>`;

  // Status badge
  const statusHtml = status ? badge(status.label, { variant: status.variant, size: 'sm' }) : '';

  // Metadata
  const metaItems: string[] = [];
  if (meta?.size) {
    metaItems.push(formatFileSize(meta.size));
  }
  if (meta?.mimeType) {
    metaItems.push(meta.mimeType);
  }
  if (meta?.updatedAt) {
    metaItems.push(`Updated ${formatDate(meta.updatedAt)}`);
  } else if (meta?.createdAt) {
    metaItems.push(`Created ${formatDate(meta.createdAt)}`);
  }
  if (meta?.author) {
    metaItems.push(`by ${meta.author}`);
  }

  const metaHtml =
    metaItems.length > 0 ? `<div class="text-xs text-text-secondary mt-1">${metaItems.join(' • ')}</div>` : '';

  // Tags
  const tagsHtml =
    meta?.tags && meta.tags.length > 0
      ? `<div class="flex flex-wrap gap-1 mt-2">
        ${meta.tags.map((tag) => badge(tag, { variant: 'default', size: 'sm' })).join('')}
      </div>`
      : '';

  // Actions
  const actionsHtml =
    actions.length > 0
      ? `<div class="flex gap-2 mt-4">
        ${actions
          .map((action) => {
            const variantMap: Record<string, string> = {
              primary: 'primary',
              secondary: 'secondary',
              danger: 'danger',
              ghost: 'ghost',
            };
            const variant = action.variant ? variantMap[action.variant] : 'ghost';

            const htmxAttrs: string[] = [];
            if (action.htmx) {
              if (action.htmx.get) htmxAttrs.push(`hx-get="${escapeHtml(action.htmx.get)}"`);
              if (action.htmx.post) htmxAttrs.push(`hx-post="${escapeHtml(action.htmx.post)}"`);
              if (action.htmx.delete) htmxAttrs.push(`hx-delete="${escapeHtml(action.htmx.delete)}"`);
              if (action.htmx.target) htmxAttrs.push(`hx-target="${escapeHtml(action.htmx.target)}"`);
              if (action.htmx.swap) htmxAttrs.push(`hx-swap="${escapeHtml(action.htmx.swap)}"`);
              if (action.htmx.confirm) htmxAttrs.push(`hx-confirm="${escapeHtml(action.htmx.confirm)}"`);
            }

            return button(action.label, {
              variant: variant as 'primary' | 'secondary' | 'danger' | 'ghost',
              size: 'sm',
              href: action.href,
              disabled: action.disabled,
              iconBefore: action.icon,
            });
          })
          .join('')}
      </div>`
      : '';

  // Content
  const content = `
    <div class="flex gap-4">
      ${iconHtml}
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            ${
              url
                ? `<a href="${escapeHtml(
                    url,
                  )}" class="font-semibold text-text-primary hover:text-primary truncate block">${escapeHtml(
                    title,
                  )}</a>`
                : `<h3 class="font-semibold text-text-primary truncate">${escapeHtml(title)}</h3>`
            }
            ${
              description
                ? `<p class="text-sm text-text-secondary mt-0.5 line-clamp-2">${escapeHtml(description)}</p>`
                : ''
            }
            ${metaHtml}
            ${tagsHtml}
          </div>
          ${statusHtml}
        </div>
        ${actionsHtml}
      </div>
    </div>
  `;

  return card(content, {
    variant: 'default',
    size: 'md',
    className: `resource-widget resource-${type} ${className}`,
    ...cardOptions,
  });
}

// ============================================
// Resource List Widget
// ============================================

/**
 * Resource list options
 */
export interface ResourceListOptions {
  /** Resources to display */
  resources: ResourceOptions[];
  /** List title */
  title?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Grid or list layout */
  layout?: 'list' | 'grid';
  /** Grid columns */
  columns?: 1 | 2 | 3 | 4;
  /** Additional CSS classes */
  className?: string;
  /** Show load more button */
  showLoadMore?: boolean;
  /** Load more URL */
  loadMoreUrl?: string;
}

/**
 * Build a resource list widget
 */
export function resourceList(options: ResourceListOptions): string {
  const {
    resources,
    title,
    emptyMessage = 'No resources found',
    layout = 'list',
    columns = 2,
    className = '',
    showLoadMore = false,
    loadMoreUrl,
  } = options;

  // Title
  const titleHtml = title ? `<h2 class="text-lg font-semibold text-text-primary mb-4">${escapeHtml(title)}</h2>` : '';

  // Empty state
  if (resources.length === 0) {
    return `<div class="${className}">
      ${titleHtml}
      <div class="text-center py-12 text-text-secondary">
        <svg class="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
        </svg>
        <p>${escapeHtml(emptyMessage)}</p>
      </div>
    </div>`;
  }

  // Layout classes
  const layoutClasses = layout === 'grid' ? `grid grid-cols-1 md:grid-cols-${columns} gap-4` : 'space-y-4';

  // Resources
  const resourcesHtml = resources.map((r) => resourceWidget(r)).join('\n');

  // Load more button
  const loadMoreHtml =
    showLoadMore && loadMoreUrl
      ? `<div class="text-center mt-6">
        ${button('Load More', {
          variant: 'outline',
          htmx: {
            get: loadMoreUrl,
            target: 'closest .resource-list',
            swap: 'beforeend',
          },
        })}
      </div>`
      : '';

  return `<div class="resource-list ${className}">
    ${titleHtml}
    <div class="${layoutClasses}">
      ${resourcesHtml}
    </div>
    ${loadMoreHtml}
  </div>`;
}

// ============================================
// Compact Resource Item
// ============================================

/**
 * Build a compact resource item (for inline display)
 */
export function resourceItem(options: Omit<ResourceOptions, 'cardOptions'>): string {
  const { type, title, description, icon, url, meta, status } = options;

  const iconHtml = `<div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-400">
    ${icon || resourceIcons[type]}
  </div>`;

  const statusHtml = status ? badge(status.label, { variant: status.variant, size: 'sm' }) : '';

  const metaText = meta?.size ? formatFileSize(meta.size) : '';

  const titleElement = url
    ? `<a href="${escapeHtml(url)}" class="font-medium text-text-primary hover:text-primary">${escapeHtml(title)}</a>`
    : `<span class="font-medium text-text-primary">${escapeHtml(title)}</span>`;

  return `<div class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
    ${iconHtml}
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        ${titleElement}
        ${statusHtml}
      </div>
      ${
        description || metaText
          ? `<p class="text-sm text-text-secondary truncate">${escapeHtml(description || metaText)}</p>`
          : ''
      }
    </div>
  </div>`;
}

// ============================================
// Preview Widget
// ============================================

/**
 * Code preview options
 */
export interface CodePreviewOptions {
  /** Code content */
  code: string;
  /** Language */
  language?: string;
  /** Filename */
  filename?: string;
  /** Show line numbers */
  lineNumbers?: boolean;
  /** Max height */
  maxHeight?: string;
  /** Copy button */
  showCopy?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build a code preview widget
 */
export function codePreview(options: CodePreviewOptions): string {
  const {
    code,
    language = 'text',
    filename,
    lineNumbers = true,
    maxHeight = '400px',
    showCopy = true,
    className = '',
  } = options;

  const lines = code.split('\n');

  const lineNumbersHtml = lineNumbers
    ? `<div class="text-right select-none pr-4 text-gray-500">
        ${lines.map((_, i) => `<div>${i + 1}</div>`).join('')}
      </div>`
    : '';

  const copyScript = showCopy
    ? `<script>
        function copyCode(btn, code) {
          navigator.clipboard.writeText(code).then(() => {
            const original = btn.innerHTML;
            btn.innerHTML = '<svg class="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
            setTimeout(() => btn.innerHTML = original, 2000);
          });
        }
      </script>`
    : '';

  const copyButton = showCopy
    ? `<button
        type="button"
        onclick="copyCode(this, ${escapeHtml(JSON.stringify(code))})"
        class="p-1.5 rounded hover:bg-gray-700 transition-colors"
        title="Copy code"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
      </button>`
    : '';

  return `<div class="code-preview rounded-lg overflow-hidden ${className}">
    ${
      filename || showCopy
        ? `
      <div class="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        ${filename ? `<span class="text-sm text-gray-300">${escapeHtml(filename)}</span>` : '<span></span>'}
        <div class="flex items-center gap-2">
          ${language ? `<span class="text-xs text-gray-500">${escapeHtml(language)}</span>` : ''}
          ${copyButton}
        </div>
      </div>
    `
        : ''
    }
    <div class="bg-gray-900 p-4 overflow-auto" style="max-height: ${maxHeight}">
      <div class="flex text-sm font-mono">
        ${lineNumbersHtml}
        <pre class="flex-1 text-gray-100"><code>${escapeHtml(code)}</code></pre>
      </div>
    </div>
    ${copyScript}
  </div>`;
}

/**
 * Image preview options
 */
export interface ImagePreviewOptions {
  /** Image URL */
  src: string;
  /** Alt text */
  alt: string;
  /** Caption */
  caption?: string;
  /** Max height */
  maxHeight?: string;
  /** Clickable (opens in new tab) */
  clickable?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build an image preview widget
 */
export function imagePreview(options: ImagePreviewOptions): string {
  const { src, alt, caption, maxHeight = '400px', clickable = true, className = '' } = options;

  const imageHtml = `<img
    src="${escapeHtml(src)}"
    alt="${escapeHtml(alt)}"
    class="max-w-full h-auto rounded-lg"
    style="max-height: ${maxHeight}"
  >`;

  const captionHtml = caption
    ? `<p class="text-sm text-text-secondary mt-2 text-center">${escapeHtml(caption)}</p>`
    : '';

  const content = clickable
    ? `<a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="block">${imageHtml}</a>`
    : imageHtml;

  return `<div class="image-preview ${className}">
    ${content}
    ${captionHtml}
  </div>`;
}
