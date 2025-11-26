/**
 * @file list.schema.ts
 * @description Zod schemas for List component options validation.
 *
 * Provides strict validation schemas for permission lists, feature lists,
 * description lists, and action lists with HTMX support.
 *
 * @example
 * ```typescript
 * import { PermissionItemSchema, PermissionListOptionsSchema } from '@frontmcp/ui';
 *
 * const itemResult = PermissionItemSchema.safeParse({
 *   scope: 'read:profile',
 *   name: 'Read Profile',
 * });
 * ```
 *
 * @module @frontmcp/ui/components/list.schema
 */

import { z } from 'zod';

// ============================================
// Permission Item Schema
// ============================================

/**
 * Permission/Scope item schema for OAuth consent
 */
export const PermissionItemSchema = z
  .object({
    /** Scope identifier */
    scope: z.string(),
    /** Display name */
    name: z.string(),
    /** Description */
    description: z.string().optional(),
    /** Icon HTML */
    icon: z.string().optional(),
    /** Required permission (cannot be unchecked) */
    required: z.boolean().optional(),
    /** Checked by default */
    checked: z.boolean().optional(),
    /** Sensitive/dangerous permission */
    sensitive: z.boolean().optional(),
  })
  .strict();

/**
 * Permission item type
 */
export type PermissionItem = z.infer<typeof PermissionItemSchema>;

/**
 * Permission list options schema
 */
export const PermissionListOptionsSchema = z
  .object({
    /** List ID */
    id: z.string().optional(),
    /** Checkable permissions */
    checkable: z.boolean().optional(),
    /** Input name for checkable */
    inputName: z.string().optional(),
    /** Group title */
    title: z.string().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Permission list options type
 */
export type PermissionListOptions = z.infer<typeof PermissionListOptionsSchema>;

// ============================================
// Feature Item Schema
// ============================================

/**
 * Feature list item schema
 */
export const FeatureItemSchema = z
  .object({
    /** Feature name */
    name: z.string(),
    /** Feature description */
    description: z.string().optional(),
    /** Icon HTML */
    icon: z.string().optional(),
    /** Included in plan */
    included: z.boolean().optional(),
  })
  .strict();

/**
 * Feature item type
 */
export type FeatureItem = z.infer<typeof FeatureItemSchema>;

/**
 * Feature list options schema
 */
export const FeatureListOptionsSchema = z
  .object({
    /** Group title */
    title: z.string().optional(),
    /** Show included/excluded styling */
    showStatus: z.boolean().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Feature list options type
 */
export type FeatureListOptions = z.infer<typeof FeatureListOptionsSchema>;

// ============================================
// Description Item Schema
// ============================================

/**
 * Description list item schema
 */
export const DescriptionItemSchema = z
  .object({
    /** Term/label */
    term: z.string(),
    /** Description/value */
    description: z.string(),
    /** Copy button */
    copyable: z.boolean().optional(),
  })
  .strict();

/**
 * Description item type
 */
export type DescriptionItem = z.infer<typeof DescriptionItemSchema>;

/**
 * Description list options schema
 */
export const DescriptionListOptionsSchema = z
  .object({
    /** Layout direction */
    direction: z.enum(['horizontal', 'vertical']).optional(),
    /** Striped rows */
    striped: z.boolean().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Description list options type
 */
export type DescriptionListOptions = z.infer<typeof DescriptionListOptionsSchema>;

// ============================================
// Action Item Schema
// ============================================

/**
 * Action list item schema
 */
export const ActionItemSchema = z
  .object({
    /** Action label */
    label: z.string(),
    /** Action description */
    description: z.string().optional(),
    /** Icon HTML */
    icon: z.string().optional(),
    /** Click URL */
    href: z.string().optional(),
    /** HTMX attributes */
    htmx: z
      .object({
        get: z.string().optional(),
        post: z.string().optional(),
        target: z.string().optional(),
        swap: z.string().optional(),
      })
      .strict()
      .optional(),
    /** Destructive action styling */
    destructive: z.boolean().optional(),
    /** Disabled state */
    disabled: z.boolean().optional(),
  })
  .strict();

/**
 * Action item type
 */
export type ActionItem = z.infer<typeof ActionItemSchema>;

/**
 * Action list options schema
 */
export const ActionListOptionsSchema = z
  .object({
    /** Divided items */
    divided: z.boolean().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Action list options type
 */
export type ActionListOptions = z.infer<typeof ActionListOptionsSchema>;
