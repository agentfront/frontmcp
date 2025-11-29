/**
 * @file card.schema.ts
 * @description Zod schemas for Card component options validation.
 *
 * Provides strict validation schemas for card options including variants,
 * sizes, HTMX attributes, and clickable behavior.
 *
 * @example
 * ```typescript
 * import { CardOptionsSchema } from '@frontmcp/ui';
 *
 * const result = CardOptionsSchema.safeParse({ variant: 'elevated' });
 * ```
 *
 * @module @frontmcp/ui/components/card.schema
 */

import { z } from 'zod';

// ============================================
// Variant and Size Schemas
// ============================================

/**
 * Card variant enum schema
 */
export const CardVariantSchema = z.enum(['default', 'outlined', 'elevated', 'filled', 'ghost']);

/**
 * Card variant type
 */
export type CardVariant = z.infer<typeof CardVariantSchema>;

/**
 * Card size enum schema
 */
export const CardSizeSchema = z.enum(['sm', 'md', 'lg']);

/**
 * Card size type
 */
export type CardSize = z.infer<typeof CardSizeSchema>;

// ============================================
// HTMX Schema
// ============================================

/**
 * HTMX attributes schema for card
 */
export const CardHtmxSchema = z
  .object({
    get: z.string().optional(),
    post: z.string().optional(),
    target: z.string().optional(),
    swap: z.string().optional(),
    trigger: z.string().optional(),
  })
  .strict()
  .optional();

/**
 * Card HTMX type
 */
export type CardHtmx = z.infer<typeof CardHtmxSchema>;

// ============================================
// Card Options Schema
// ============================================

/**
 * Complete card options schema
 */
export const CardOptionsSchema = z
  .object({
    /** Card variant */
    variant: CardVariantSchema.optional(),
    /** Card size (padding) */
    size: CardSizeSchema.optional(),
    /** Card title */
    title: z.string().optional(),
    /** Card subtitle/description */
    subtitle: z.string().optional(),
    /** Header actions (HTML string) */
    headerActions: z.string().optional(),
    /** Footer content (HTML string) */
    footer: z.string().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** Card ID */
    id: z.string().optional(),
    /** HTMX attributes */
    htmx: CardHtmxSchema,
    /** Data attributes */
    data: z.record(z.string(), z.string()).optional(),
    /** Clickable card (adds hover effects) */
    clickable: z.boolean().optional(),
    /** Click handler URL */
    href: z.string().optional(),
  })
  .strict();

/**
 * Card options type (derived from schema)
 */
export type CardOptions = z.infer<typeof CardOptionsSchema>;

// ============================================
// Card Group Schema
// ============================================

/**
 * Card group options schema
 */
export const CardGroupOptionsSchema = z
  .object({
    /** Direction */
    direction: z.enum(['horizontal', 'vertical']).optional(),
    /** Gap between cards */
    gap: z.enum(['sm', 'md', 'lg']).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Card group options type
 */
export type CardGroupOptions = z.infer<typeof CardGroupOptionsSchema>;
