/**
 * @file alert.schema.ts
 * @description Zod schemas for Alert and Toast component options validation.
 *
 * Provides strict validation schemas for alert options including variants,
 * dismissible alerts, and toast notifications with positioning.
 *
 * @example
 * ```typescript
 * import { AlertOptionsSchema, ToastOptionsSchema } from '@frontmcp/ui';
 *
 * const alertResult = AlertOptionsSchema.safeParse({ variant: 'success' });
 * const toastResult = ToastOptionsSchema.safeParse({ position: 'top-right' });
 * ```
 *
 * @module @frontmcp/ui/components/alert.schema
 */

import { z } from 'zod';

// ============================================
// Variant Schema
// ============================================

/**
 * Alert variant enum schema
 */
export const AlertVariantSchema = z.enum(['info', 'success', 'warning', 'danger', 'neutral']);

/**
 * Alert variant type
 */
export type AlertVariant = z.infer<typeof AlertVariantSchema>;

// ============================================
// OnDismiss Schema
// ============================================

/**
 * Dismiss button HTMX options schema
 */
export const AlertOnDismissSchema = z
  .object({
    delete: z.string().optional(),
    target: z.string().optional(),
    swap: z.string().optional(),
  })
  .strict()
  .optional();

/**
 * Alert onDismiss type
 */
export type AlertOnDismiss = z.infer<typeof AlertOnDismissSchema>;

// ============================================
// Alert Options Schema
// ============================================

/**
 * Complete alert options schema
 */
export const AlertOptionsSchema = z
  .object({
    /** Alert variant */
    variant: AlertVariantSchema.optional(),
    /** Alert title */
    title: z.string().optional(),
    /** Show icon */
    showIcon: z.boolean().optional(),
    /** Custom icon (HTML string, overrides default) */
    icon: z.string().optional(),
    /** Dismissible alert */
    dismissible: z.boolean().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** Alert ID */
    id: z.string().optional(),
    /** Actions (HTML string for buttons) */
    actions: z.string().optional(),
    /** HTMX for dismiss */
    onDismiss: AlertOnDismissSchema,
  })
  .strict();

/**
 * Alert options type (derived from schema)
 */
export type AlertOptions = z.infer<typeof AlertOptionsSchema>;

// ============================================
// Toast Position Schema
// ============================================

/**
 * Toast position enum schema
 */
export const ToastPositionSchema = z.enum([
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  'top-center',
  'bottom-center',
]);

/**
 * Toast position type
 */
export type ToastPosition = z.infer<typeof ToastPositionSchema>;

// ============================================
// Toast Options Schema
// ============================================

/**
 * Complete toast options schema
 */
export const ToastOptionsSchema = z
  .object({
    /** Toast variant */
    variant: AlertVariantSchema.optional(),
    /** Toast title */
    title: z.string().optional(),
    /** Duration in ms (0 = no auto-dismiss) */
    duration: z.number().min(0).optional(),
    /** Position */
    position: ToastPositionSchema.optional(),
    /** Toast ID */
    id: z.string().optional(),
  })
  .strict();

/**
 * Toast options type (derived from schema)
 */
export type ToastOptions = z.infer<typeof ToastOptionsSchema>;
