/**
 * Avatar Component
 *
 * User avatars and avatar groups.
 */

import { escapeHtml } from '../layouts/base';

// ============================================
// Avatar Types
// ============================================

/**
 * Avatar size options
 */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/**
 * Avatar shape options
 */
export type AvatarShape = 'circle' | 'square' | 'rounded';

/**
 * Avatar status options
 */
export type AvatarStatus = 'online' | 'offline' | 'busy' | 'away' | 'none';

/**
 * Avatar component options
 */
export interface AvatarOptions {
  /** Image source URL */
  src?: string;
  /** Alt text / name */
  alt: string;
  /** Avatar size */
  size?: AvatarSize;
  /** Avatar shape */
  shape?: AvatarShape;
  /** Status indicator */
  status?: AvatarStatus;
  /** Additional CSS classes */
  className?: string;
  /** Click handler URL */
  href?: string;
  /** Custom initials (overrides auto-generation) */
  initials?: string;
  /** Background color for initials (CSS color) */
  bgColor?: string;
}

// ============================================
// Avatar Helpers
// ============================================

/**
 * Get size CSS classes
 */
function getSizeClasses(size: AvatarSize): { container: string; text: string; status: string } {
  const sizes: Record<AvatarSize, { container: string; text: string; status: string }> = {
    xs: { container: 'w-6 h-6', text: 'text-xs', status: 'w-2 h-2 border' },
    sm: { container: 'w-8 h-8', text: 'text-xs', status: 'w-2.5 h-2.5 border' },
    md: { container: 'w-10 h-10', text: 'text-sm', status: 'w-3 h-3 border-2' },
    lg: { container: 'w-12 h-12', text: 'text-base', status: 'w-3.5 h-3.5 border-2' },
    xl: { container: 'w-16 h-16', text: 'text-lg', status: 'w-4 h-4 border-2' },
    '2xl': { container: 'w-24 h-24', text: 'text-2xl', status: 'w-5 h-5 border-2' },
  };
  return sizes[size];
}

/**
 * Get shape CSS classes
 */
function getShapeClasses(shape: AvatarShape): string {
  const shapes: Record<AvatarShape, string> = {
    circle: 'rounded-full',
    square: 'rounded-none',
    rounded: 'rounded-lg',
  };
  return shapes[shape];
}

/**
 * Get status CSS classes
 */
function getStatusClasses(status: AvatarStatus): string {
  const statuses: Record<AvatarStatus, string> = {
    online: 'bg-success',
    offline: 'bg-gray-400',
    busy: 'bg-danger',
    away: 'bg-warning',
    none: '',
  };
  return statuses[status];
}

/**
 * Generate initials from name
 */
function generateInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Generate background color from name (deterministic)
 */
function generateBgColor(name: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-red-500',
    'bg-orange-500',
    'bg-teal-500',
    'bg-cyan-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// ============================================
// Avatar Builder
// ============================================

/**
 * Build an avatar component
 */
export function avatar(options: AvatarOptions): string {
  const { src, alt, size = 'md', shape = 'circle', status = 'none', className = '', href, initials, bgColor } = options;

  const sizeClasses = getSizeClasses(size);
  const shapeClasses = getShapeClasses(shape);
  const statusColor = getStatusClasses(status);

  const displayInitials = initials || generateInitials(alt);
  const displayBgColor = bgColor || generateBgColor(alt);

  const containerClasses = [
    'relative inline-flex items-center justify-center',
    'overflow-hidden',
    sizeClasses.container,
    shapeClasses,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const contentHtml = src
    ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" class="w-full h-full object-cover">`
    : `<span class="font-medium text-white ${sizeClasses.text}">${escapeHtml(displayInitials)}</span>`;

  const bgClasses = src ? 'bg-gray-200' : displayBgColor;

  const statusHtml =
    status !== 'none'
      ? `<span class="absolute bottom-0 right-0 block ${sizeClasses.status} ${shapeClasses} ${statusColor} border-white"></span>`
      : '';

  const innerHtml = `
    <div class="${containerClasses} ${bgClasses}">
      ${contentHtml}
      ${statusHtml}
    </div>
  `;

  if (href) {
    return `<a href="${escapeHtml(href)}" class="inline-block">${innerHtml}</a>`;
  }

  return innerHtml;
}

// ============================================
// Avatar Group
// ============================================

/**
 * Avatar group options
 */
export interface AvatarGroupOptions {
  /** Maximum visible avatars */
  max?: number;
  /** Avatar size */
  size?: AvatarSize;
  /** Overlap amount */
  spacing?: 'tight' | 'normal' | 'loose';
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build an avatar group
 */
export function avatarGroup(avatars: AvatarOptions[], options: AvatarGroupOptions = {}): string {
  const { max = 5, size = 'md', spacing = 'normal', className = '' } = options;

  const spacingClasses: Record<string, string> = {
    tight: '-space-x-3',
    normal: '-space-x-2',
    loose: '-space-x-1',
  };

  const visibleAvatars = avatars.slice(0, max);
  const remainingCount = avatars.length - max;

  const avatarsHtml = visibleAvatars
    .map((opts, index) => {
      const avatarHtml = avatar({ ...opts, size });
      return `<div class="relative ring-2 ring-white rounded-full" style="z-index: ${visibleAvatars.length - index}">
        ${avatarHtml}
      </div>`;
    })
    .join('\n');

  const sizeClasses = getSizeClasses(size);
  const overflowHtml =
    remainingCount > 0
      ? `<div class="relative ring-2 ring-white rounded-full" style="z-index: 0">
        <div class="${sizeClasses.container} rounded-full bg-gray-200 flex items-center justify-center">
          <span class="${sizeClasses.text} font-medium text-gray-600">+${remainingCount}</span>
        </div>
      </div>`
      : '';

  return `<div class="flex ${spacingClasses[spacing]} ${className}">
    ${avatarsHtml}
    ${overflowHtml}
  </div>`;
}

// ============================================
// Avatar with Text
// ============================================

/**
 * Avatar with name/details options
 */
export interface AvatarWithTextOptions extends AvatarOptions {
  /** Primary text (name) */
  name: string;
  /** Secondary text (email, role, etc.) */
  subtitle?: string;
  /** Text alignment */
  align?: 'left' | 'right';
}

/**
 * Build avatar with name and details
 */
export function avatarWithText(options: AvatarWithTextOptions): string {
  const { name, subtitle, align = 'left', ...avatarOptions } = options;

  const avatarHtml = avatar({ ...avatarOptions, alt: avatarOptions.alt || name });

  const textHtml = `
    <div class="${align === 'right' ? 'text-right' : ''}">
      <div class="font-medium text-text-primary">${escapeHtml(name)}</div>
      ${subtitle ? `<div class="text-sm text-text-secondary">${escapeHtml(subtitle)}</div>` : ''}
    </div>
  `;

  const flexDirection = align === 'right' ? 'flex-row-reverse' : 'flex-row';

  return `<div class="flex items-center gap-3 ${flexDirection}">
    ${avatarHtml}
    ${textHtml}
  </div>`;
}
