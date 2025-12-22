/**
 * @file modal.schema.ts
 * @description Zod schemas for Modal, ConfirmModal, and Drawer component options validation.
 *
 * Provides strict validation schemas for modal options including sizes,
 * close behavior, confirm dialogs, and drawers with positioning.
 *
 * @example
 * ```typescript
 * import { ModalOptionsSchema, DrawerOptionsSchema } from '@frontmcp/ui';
 *
 * const modalResult = ModalOptionsSchema.safeParse({
 *   id: 'my-modal',
 *   title: 'Dialog Title',
 * });
 * ```
 *
 * @module @frontmcp/ui/components/modal.schema
 */

import { z } from 'zod';

// ============================================
// Size Schema
// ============================================

/**
 * Modal size enum schema
 */
export const ModalSizeSchema = z.enum(['sm', 'md', 'lg', 'xl', 'full']);

/**
 * Modal size type
 */
export type ModalSize = z.infer<typeof ModalSizeSchema>;

// ============================================
// Modal Options Schema
// ============================================

/**
 * Complete modal options schema
 */
export const ModalOptionsSchema = z
  .object({
    /** Modal ID (required) */
    id: z.string(),
    /** Modal title */
    title: z.string().optional(),
    /** Modal size */
    size: ModalSizeSchema.optional(),
    /** Show close button */
    showClose: z.boolean().optional(),
    /** Close on backdrop click */
    closeOnBackdrop: z.boolean().optional(),
    /** Close on escape key */
    closeOnEscape: z.boolean().optional(),
    /** Footer content (HTML string) */
    footer: z.string().optional(),
    /** Additional CSS classes for modal */
    className: z.string().optional(),
    /** Initially visible */
    open: z.boolean().optional(),
  })
  .strict();

/**
 * Modal options type (derived from schema)
 */
export type ModalOptions = z.infer<typeof ModalOptionsSchema>;

// ============================================
// Confirm Modal Schema
// ============================================

/**
 * Confirm modal variant schema
 */
export const ConfirmModalVariantSchema = z.enum(['info', 'warning', 'danger']);

/**
 * Confirm modal variant type
 */
export type ConfirmModalVariant = z.infer<typeof ConfirmModalVariantSchema>;

/**
 * Confirm modal options schema
 */
export const ConfirmModalOptionsSchema = z
  .object({
    /** Modal ID (required) */
    id: z.string(),
    /** Confirm message */
    message: z.string(),
    /** Title */
    title: z.string().optional(),
    /** Variant/severity */
    variant: ConfirmModalVariantSchema.optional(),
    /** Confirm button text */
    confirmText: z.string().optional(),
    /** Cancel button text */
    cancelText: z.string().optional(),
    /** Initially visible */
    open: z.boolean().optional(),
    /** Confirm action URL */
    confirmHref: z.string().optional(),
  })
  .strict();

/**
 * Confirm modal options type
 */
export type ConfirmModalOptions = z.infer<typeof ConfirmModalOptionsSchema>;

// ============================================
// Drawer Schema
// ============================================

/**
 * Drawer position enum schema
 */
export const DrawerPositionSchema = z.enum(['left', 'right', 'top', 'bottom']);

/**
 * Drawer position type
 */
export type DrawerPosition = z.infer<typeof DrawerPositionSchema>;

/**
 * Drawer options schema
 */
export const DrawerOptionsSchema = z
  .object({
    /** Drawer ID (required) */
    id: z.string(),
    /** Position */
    position: DrawerPositionSchema.optional(),
    /** Size (width for left/right, height for top/bottom) */
    size: ModalSizeSchema.optional(),
    /** Drawer title */
    title: z.string().optional(),
    /** Show close button */
    showClose: z.boolean().optional(),
    /** Footer content (HTML string) */
    footer: z.string().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** Initially visible */
    open: z.boolean().optional(),
  })
  .strict();

/**
 * Drawer options type
 */
export type DrawerOptions = z.infer<typeof DrawerOptionsSchema>;

// ============================================
// Modal Trigger Schema
// ============================================

/**
 * Modal trigger options schema
 */
export const ModalTriggerOptionsSchema = z
  .object({
    /** Target modal ID (required) */
    targetId: z.string(),
    /** Trigger text */
    text: z.string().optional(),
    /** HTML tag to use */
    tag: z.enum(['button', 'a', 'span', 'div']).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Modal trigger options type
 */
export type ModalTriggerOptions = z.infer<typeof ModalTriggerOptionsSchema>;
