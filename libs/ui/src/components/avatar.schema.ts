/**
 * @file avatar.schema.ts
 * @description Zod schemas for Avatar component options validation.
 *
 * Provides strict validation schemas for avatar options including sizes,
 * shapes, status indicators, and avatar groups with text.
 *
 * @example
 * ```typescript
 * import { AvatarOptionsSchema } from '@frontmcp/ui';
 *
 * const result = AvatarOptionsSchema.safeParse({
 *   alt: 'John Doe',
 *   size: 'lg',
 * });
 * ```
 *
 * @module @frontmcp/ui/components/avatar.schema
 */

import { z } from 'zod';

// ============================================
// Size, Shape, and Status Schemas
// ============================================

/**
 * Avatar size enum schema
 */
export const AvatarSizeSchema = z.enum(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);

/**
 * Avatar size type
 */
export type AvatarSize = z.infer<typeof AvatarSizeSchema>;

/**
 * Avatar shape enum schema
 */
export const AvatarShapeSchema = z.enum(['circle', 'square', 'rounded']);

/**
 * Avatar shape type
 */
export type AvatarShape = z.infer<typeof AvatarShapeSchema>;

/**
 * Avatar status enum schema
 */
export const AvatarStatusSchema = z.enum(['online', 'offline', 'busy', 'away', 'none']);

/**
 * Avatar status type
 */
export type AvatarStatus = z.infer<typeof AvatarStatusSchema>;

// ============================================
// Avatar Options Schema
// ============================================

/**
 * Complete avatar options schema
 */
export const AvatarOptionsSchema = z
  .object({
    /** Image source URL */
    src: z.string().optional(),
    /** Alt text / name (required) */
    alt: z.string(),
    /** Avatar size */
    size: AvatarSizeSchema.optional(),
    /** Avatar shape */
    shape: AvatarShapeSchema.optional(),
    /** Status indicator */
    status: AvatarStatusSchema.optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** Click handler URL */
    href: z.string().optional(),
    /** Custom initials (overrides auto-generation) */
    initials: z.string().optional(),
    /** Background color for initials (CSS color) */
    bgColor: z.string().optional(),
  })
  .strict();

/**
 * Avatar options type (derived from schema)
 */
export type AvatarOptions = z.infer<typeof AvatarOptionsSchema>;

// ============================================
// Avatar Group Schema
// ============================================

/**
 * Avatar group spacing schema
 */
export const AvatarSpacingSchema = z.enum(['tight', 'normal', 'loose']);

/**
 * Avatar group options schema
 */
export const AvatarGroupOptionsSchema = z
  .object({
    /** Maximum visible avatars */
    max: z.number().min(1).optional(),
    /** Avatar size */
    size: AvatarSizeSchema.optional(),
    /** Overlap amount */
    spacing: AvatarSpacingSchema.optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Avatar group options type
 */
export type AvatarGroupOptions = z.infer<typeof AvatarGroupOptionsSchema>;

// ============================================
// Avatar with Text Schema
// ============================================

/**
 * Avatar with text options schema
 */
export const AvatarWithTextOptionsSchema = AvatarOptionsSchema.extend({
  /** Primary text (name) */
  name: z.string(),
  /** Secondary text (email, role, etc.) */
  subtitle: z.string().optional(),
  /** Text alignment */
  align: z.enum(['left', 'right']).optional(),
}).strict();

/**
 * Avatar with text options type
 */
export type AvatarWithTextOptions = z.infer<typeof AvatarWithTextOptionsSchema>;
