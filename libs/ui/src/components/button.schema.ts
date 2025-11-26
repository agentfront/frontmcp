/**
 * @file button.schema.ts
 * @description Zod schemas for Button component options validation.
 *
 * Provides strict validation schemas for button options including variants,
 * sizes, HTMX attributes, and data attributes. All schemas use .strict()
 * to reject unknown properties.
 *
 * @example
 * ```typescript
 * import { ButtonOptionsSchema } from '@frontmcp/ui';
 *
 * // Validate button options
 * const result = ButtonOptionsSchema.safeParse({ variant: 'primary' });
 * if (result.success) {
 *   // Use result.data
 * }
 * ```
 *
 * @module @frontmcp/ui/components/button.schema
 */

import { z } from 'zod';

// ============================================
// Variant and Size Schemas
// ============================================

/**
 * Button variant enum schema
 */
export const ButtonVariantSchema = z.enum(['primary', 'secondary', 'outline', 'ghost', 'danger', 'success', 'link']);

/**
 * Button variant type
 */
export type ButtonVariant = z.infer<typeof ButtonVariantSchema>;

/**
 * Button size enum schema
 */
export const ButtonSizeSchema = z.enum(['xs', 'sm', 'md', 'lg', 'xl']);

/**
 * Button size type
 */
export type ButtonSize = z.infer<typeof ButtonSizeSchema>;

// ============================================
// HTMX Schema
// ============================================

/**
 * HTMX attributes schema for button
 */
export const ButtonHtmxSchema = z
  .object({
    get: z.string().optional(),
    post: z.string().optional(),
    put: z.string().optional(),
    delete: z.string().optional(),
    target: z.string().optional(),
    swap: z.string().optional(),
    trigger: z.string().optional(),
    confirm: z.string().optional(),
    indicator: z.string().optional(),
  })
  .strict()
  .optional();

/**
 * HTMX attributes type
 */
export type ButtonHtmx = z.infer<typeof ButtonHtmxSchema>;

// ============================================
// Button Options Schema
// ============================================

/**
 * Complete button options schema
 */
export const ButtonOptionsSchema = z
  .object({
    /** Button variant */
    variant: ButtonVariantSchema.optional(),
    /** Button size */
    size: ButtonSizeSchema.optional(),
    /** Button type attribute */
    type: z.enum(['button', 'submit', 'reset']).optional(),
    /** Disabled state */
    disabled: z.boolean().optional(),
    /** Loading state */
    loading: z.boolean().optional(),
    /** Full width */
    fullWidth: z.boolean().optional(),
    /** Icon before text (HTML string) */
    iconBefore: z.string().optional(),
    /** Icon after text (HTML string) */
    iconAfter: z.string().optional(),
    /** Icon only (no text) */
    iconOnly: z.boolean().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** Button ID */
    id: z.string().optional(),
    /** Name attribute */
    name: z.string().optional(),
    /** Value attribute */
    value: z.string().optional(),
    /** Click handler (URL for links) */
    href: z.string().optional(),
    /** Open in new tab */
    target: z.enum(['_blank', '_self']).optional(),
    /** HTMX attributes */
    htmx: ButtonHtmxSchema,
    /** Data attributes */
    data: z.record(z.string()).optional(),
    /** ARIA label */
    ariaLabel: z.string().optional(),
  })
  .strict();

/**
 * Button options type (derived from schema)
 */
export type ButtonOptions = z.infer<typeof ButtonOptionsSchema>;

// ============================================
// Button Group Schema
// ============================================

/**
 * Button group options schema
 */
export const ButtonGroupOptionsSchema = z
  .object({
    /** Attach buttons visually */
    attached: z.boolean().optional(),
    /** Direction */
    direction: z.enum(['horizontal', 'vertical']).optional(),
    /** Gap between buttons */
    gap: z.enum(['sm', 'md', 'lg']).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Button group options type
 */
export type ButtonGroupOptions = z.infer<typeof ButtonGroupOptionsSchema>;
