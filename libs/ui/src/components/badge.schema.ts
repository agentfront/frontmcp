/**
 * @file badge.schema.ts
 * @description Zod schemas for Badge component options validation.
 *
 * Provides strict validation schemas for badge options including variants,
 * sizes, dot indicators, and removable badges with HTMX support.
 *
 * @example
 * ```typescript
 * import { BadgeOptionsSchema } from '@frontmcp/ui';
 *
 * const result = BadgeOptionsSchema.safeParse({ variant: 'success' });
 * ```
 *
 * @module @frontmcp/ui/components/badge.schema
 */

import { z } from 'zod';

// ============================================
// Variant and Size Schemas
// ============================================

/**
 * Badge variant enum schema
 */
export const BadgeVariantSchema = z.enum([
  'default',
  'primary',
  'secondary',
  'success',
  'warning',
  'danger',
  'info',
  'outline',
]);

/**
 * Badge variant type
 */
export type BadgeVariant = z.infer<typeof BadgeVariantSchema>;

/**
 * Badge size enum schema
 */
export const BadgeSizeSchema = z.enum(['sm', 'md', 'lg']);

/**
 * Badge size type
 */
export type BadgeSize = z.infer<typeof BadgeSizeSchema>;

// ============================================
// OnRemove Schema
// ============================================

/**
 * Remove button HTMX options schema
 */
export const BadgeOnRemoveSchema = z
  .object({
    delete: z.string().optional(),
    target: z.string().optional(),
    swap: z.string().optional(),
    confirm: z.string().optional(),
  })
  .strict()
  .optional();

/**
 * Badge onRemove type
 */
export type BadgeOnRemove = z.infer<typeof BadgeOnRemoveSchema>;

// ============================================
// Badge Options Schema
// ============================================

/**
 * Complete badge options schema
 */
export const BadgeOptionsSchema = z
  .object({
    /** Badge variant */
    variant: BadgeVariantSchema.optional(),
    /** Badge size */
    size: BadgeSizeSchema.optional(),
    /** Rounded pill style */
    pill: z.boolean().optional(),
    /** Icon before text (HTML string) */
    icon: z.string().optional(),
    /** Dot indicator (no text) */
    dot: z.boolean().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** Removable badge */
    removable: z.boolean().optional(),
    /** Remove button HTMX options */
    onRemove: BadgeOnRemoveSchema,
  })
  .strict();

/**
 * Badge options type (derived from schema)
 */
export type BadgeOptions = z.infer<typeof BadgeOptionsSchema>;

// ============================================
// Badge Group Schema
// ============================================

/**
 * Badge group options schema
 */
export const BadgeGroupOptionsSchema = z
  .object({
    /** Gap between badges */
    gap: z.enum(['sm', 'md', 'lg']).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Badge group options type
 */
export type BadgeGroupOptions = z.infer<typeof BadgeGroupOptionsSchema>;
