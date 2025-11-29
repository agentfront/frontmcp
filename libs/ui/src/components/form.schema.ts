/**
 * @file form.schema.ts
 * @description Zod schemas for Form component options validation.
 *
 * Provides strict validation schemas for all form-related components including
 * input, select, textarea, checkbox, radio groups, and form layouts.
 *
 * @example
 * ```typescript
 * import { InputOptionsSchema, SelectOptionsSchema } from '@frontmcp/ui';
 *
 * const inputResult = InputOptionsSchema.safeParse({
 *   name: 'email',
 *   type: 'email',
 *   label: 'Email Address',
 * });
 * ```
 *
 * @module @frontmcp/ui/components/form.schema
 */

import { z } from 'zod';

// ============================================
// Input Type Schemas
// ============================================

/**
 * Input type enum schema
 */
export const InputTypeSchema = z.enum([
  'text',
  'email',
  'password',
  'number',
  'tel',
  'url',
  'search',
  'date',
  'time',
  'datetime-local',
  'hidden',
]);

/**
 * Input type
 */
export type InputType = z.infer<typeof InputTypeSchema>;

/**
 * Input size enum schema
 */
export const InputSizeSchema = z.enum(['sm', 'md', 'lg']);

/**
 * Input size type
 */
export type InputSize = z.infer<typeof InputSizeSchema>;

/**
 * Input state enum schema
 */
export const InputStateSchema = z.enum(['default', 'error', 'success', 'warning']);

/**
 * Input state type
 */
export type InputState = z.infer<typeof InputStateSchema>;

// ============================================
// HTMX Schema for Form Fields
// ============================================

/**
 * Form field HTMX options schema
 */
export const FormHtmxSchema = z
  .object({
    post: z.string().optional(),
    get: z.string().optional(),
    target: z.string().optional(),
    swap: z.string().optional(),
    trigger: z.string().optional(),
    validate: z.boolean().optional(),
  })
  .strict()
  .optional();

/**
 * Form field HTMX type
 */
export type FormHtmx = z.infer<typeof FormHtmxSchema>;

// ============================================
// Input Options Schema
// ============================================

/**
 * Complete input options schema
 */
export const InputOptionsSchema = z
  .object({
    /** Input type */
    type: InputTypeSchema.optional(),
    /** Input name (required) */
    name: z.string(),
    /** Input ID (defaults to name) */
    id: z.string().optional(),
    /** Input value */
    value: z.string().optional(),
    /** Placeholder text */
    placeholder: z.string().optional(),
    /** Label text */
    label: z.string().optional(),
    /** Helper text */
    helper: z.string().optional(),
    /** Error message */
    error: z.string().optional(),
    /** Input size */
    size: InputSizeSchema.optional(),
    /** Input state */
    state: InputStateSchema.optional(),
    /** Required field */
    required: z.boolean().optional(),
    /** Disabled state */
    disabled: z.boolean().optional(),
    /** Readonly state */
    readonly: z.boolean().optional(),
    /** Autocomplete attribute */
    autocomplete: z.string().optional(),
    /** Pattern for validation */
    pattern: z.string().optional(),
    /** Min value (for number/date) */
    min: z.union([z.string(), z.number()]).optional(),
    /** Max value (for number/date) */
    max: z.union([z.string(), z.number()]).optional(),
    /** Step value (for number) */
    step: z.union([z.string(), z.number()]).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** HTMX attributes */
    htmx: FormHtmxSchema,
    /** Data attributes */
    data: z.record(z.string(), z.string()).optional(),
    /** Icon before input (HTML string) */
    iconBefore: z.string().optional(),
    /** Icon after input (HTML string) */
    iconAfter: z.string().optional(),
  })
  .strict();

/**
 * Input options type (derived from schema)
 */
export type InputOptions = z.infer<typeof InputOptionsSchema>;

// ============================================
// Select Options Schema
// ============================================

/**
 * Select option item schema
 */
export const SelectOptionItemSchema = z
  .object({
    value: z.string(),
    label: z.string(),
    disabled: z.boolean().optional(),
    selected: z.boolean().optional(),
  })
  .strict();

/**
 * Select option item type
 */
export type SelectOptionItem = z.infer<typeof SelectOptionItemSchema>;

/**
 * Complete select options schema
 */
export const SelectOptionsSchema = z
  .object({
    /** Input name (required) */
    name: z.string(),
    /** Input ID (defaults to name) */
    id: z.string().optional(),
    /** Input value */
    value: z.string().optional(),
    /** Placeholder text */
    placeholder: z.string().optional(),
    /** Label text */
    label: z.string().optional(),
    /** Helper text */
    helper: z.string().optional(),
    /** Error message */
    error: z.string().optional(),
    /** Input size */
    size: InputSizeSchema.optional(),
    /** Input state */
    state: InputStateSchema.optional(),
    /** Required field */
    required: z.boolean().optional(),
    /** Disabled state */
    disabled: z.boolean().optional(),
    /** Readonly state */
    readonly: z.boolean().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** HTMX attributes */
    htmx: FormHtmxSchema,
    /** Data attributes */
    data: z.record(z.string(), z.string()).optional(),
    /** Icon before input (HTML string) */
    iconBefore: z.string().optional(),
    /** Icon after input (HTML string) */
    iconAfter: z.string().optional(),
    /** Select options (required) */
    options: z.array(SelectOptionItemSchema),
    /** Multiple selection */
    multiple: z.boolean().optional(),
  })
  .strict();

/**
 * Select options type
 */
export type SelectOptions = z.infer<typeof SelectOptionsSchema>;

// ============================================
// Textarea Options Schema
// ============================================

/**
 * Textarea resize enum schema
 */
export const TextareaResizeSchema = z.enum(['none', 'vertical', 'horizontal', 'both']);

/**
 * Complete textarea options schema
 */
export const TextareaOptionsSchema = z
  .object({
    /** Input name (required) */
    name: z.string(),
    /** Input ID (defaults to name) */
    id: z.string().optional(),
    /** Input value */
    value: z.string().optional(),
    /** Placeholder text */
    placeholder: z.string().optional(),
    /** Label text */
    label: z.string().optional(),
    /** Helper text */
    helper: z.string().optional(),
    /** Error message */
    error: z.string().optional(),
    /** Input size */
    size: InputSizeSchema.optional(),
    /** Input state */
    state: InputStateSchema.optional(),
    /** Required field */
    required: z.boolean().optional(),
    /** Disabled state */
    disabled: z.boolean().optional(),
    /** Readonly state */
    readonly: z.boolean().optional(),
    /** Autocomplete attribute */
    autocomplete: z.string().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** HTMX attributes */
    htmx: FormHtmxSchema,
    /** Data attributes */
    data: z.record(z.string(), z.string()).optional(),
    /** Icon before input (HTML string) */
    iconBefore: z.string().optional(),
    /** Icon after input (HTML string) */
    iconAfter: z.string().optional(),
    /** Number of rows */
    rows: z.number().min(1).optional(),
    /** Resize behavior */
    resize: TextareaResizeSchema.optional(),
  })
  .strict();

/**
 * Textarea options type
 */
export type TextareaOptions = z.infer<typeof TextareaOptionsSchema>;

// ============================================
// Checkbox Options Schema
// ============================================

/**
 * Checkbox HTMX options schema
 */
export const CheckboxHtmxSchema = z
  .object({
    post: z.string().optional(),
    get: z.string().optional(),
    target: z.string().optional(),
    swap: z.string().optional(),
    trigger: z.string().optional(),
  })
  .strict()
  .optional();

/**
 * Complete checkbox options schema
 */
export const CheckboxOptionsSchema = z
  .object({
    /** Input name (required) */
    name: z.string(),
    /** Input ID */
    id: z.string().optional(),
    /** Input value */
    value: z.string().optional(),
    /** Label text (required) */
    label: z.string(),
    /** Checked state */
    checked: z.boolean().optional(),
    /** Disabled state */
    disabled: z.boolean().optional(),
    /** Helper text */
    helper: z.string().optional(),
    /** Error message */
    error: z.string().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** HTMX attributes */
    htmx: CheckboxHtmxSchema,
  })
  .strict();

/**
 * Checkbox options type
 */
export type CheckboxOptions = z.infer<typeof CheckboxOptionsSchema>;

// ============================================
// Radio Group Options Schema
// ============================================

/**
 * Radio option item schema
 */
export const RadioOptionItemSchema = z
  .object({
    value: z.string(),
    label: z.string(),
    disabled: z.boolean().optional(),
  })
  .strict();

/**
 * Radio option item type
 */
export type RadioOptionItem = z.infer<typeof RadioOptionItemSchema>;

/**
 * Complete radio group options schema
 */
export const RadioGroupOptionsSchema = z
  .object({
    /** Group name (required) */
    name: z.string(),
    /** Radio options (required) */
    options: z.array(RadioOptionItemSchema),
    /** Selected value */
    value: z.string().optional(),
    /** Label for the group */
    label: z.string().optional(),
    /** Helper text */
    helper: z.string().optional(),
    /** Error message */
    error: z.string().optional(),
    /** Layout direction */
    direction: z.enum(['horizontal', 'vertical']).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Radio group options type
 */
export type RadioGroupOptions = z.infer<typeof RadioGroupOptionsSchema>;

// ============================================
// Form Options Schema
// ============================================

/**
 * Form method enum schema
 */
export const FormMethodSchema = z.enum(['get', 'post', 'dialog']);

/**
 * Form enctype enum schema
 */
export const FormEnctypeSchema = z.enum(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);

/**
 * Form HTMX options schema
 */
export const FormFormHtmxSchema = z
  .object({
    post: z.string().optional(),
    put: z.string().optional(),
    patch: z.string().optional(),
    delete: z.string().optional(),
    target: z.string().optional(),
    swap: z.string().optional(),
    encoding: z.string().optional(),
  })
  .strict()
  .optional();

/**
 * Complete form options schema
 */
export const FormOptionsSchema = z
  .object({
    /** Form action URL */
    action: z.string().optional(),
    /** Form method */
    method: FormMethodSchema.optional(),
    /** Form ID */
    id: z.string().optional(),
    /** Form enctype */
    enctype: FormEnctypeSchema.optional(),
    /** Disable browser validation */
    novalidate: z.boolean().optional(),
    /** Autocomplete behavior */
    autocomplete: z.enum(['on', 'off']).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
    /** HTMX attributes */
    htmx: FormFormHtmxSchema,
  })
  .strict();

/**
 * Form options type
 */
export type FormOptions = z.infer<typeof FormOptionsSchema>;

// ============================================
// Form Row & Section Options
// ============================================

/**
 * Form row options schema
 */
export const FormRowOptionsSchema = z
  .object({
    /** Number of columns */
    cols: z.number().min(1).max(12).optional(),
    /** Gap between columns */
    gap: z.enum(['sm', 'md', 'lg']).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Form row options type
 */
export type FormRowOptions = z.infer<typeof FormRowOptionsSchema>;

/**
 * Form section options schema
 */
export const FormSectionOptionsSchema = z
  .object({
    /** Section title */
    title: z.string().optional(),
    /** Section description */
    description: z.string().optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Form section options type
 */
export type FormSectionOptions = z.infer<typeof FormSectionOptionsSchema>;

/**
 * Form actions options schema
 */
export const FormActionsOptionsSchema = z
  .object({
    /** Alignment */
    align: z.enum(['left', 'center', 'right', 'between']).optional(),
    /** Additional CSS classes */
    className: z.string().optional(),
  })
  .strict();

/**
 * Form actions options type
 */
export type FormActionsOptions = z.infer<typeof FormActionsOptionsSchema>;
