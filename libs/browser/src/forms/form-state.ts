// file: libs/browser/src/forms/form-state.ts
/**
 * Form State Management
 *
 * Provides form state tracking, validation, and submission handling
 * for browser MCP components.
 *
 * @example Basic usage
 * ```typescript
 * import { createFormState } from '@frontmcp/browser';
 * import { z } from 'zod';
 *
 * const form = createFormState({
 *   initialValues: {
 *     email: '',
 *     password: '',
 *   },
 *   schema: z.object({
 *     email: z.string().email(),
 *     password: z.string().min(8),
 *   }),
 *   onSubmit: async (values) => {
 *     await api.login(values);
 *   },
 * });
 *
 * // Update field
 * form.setFieldValue('email', 'user@example.com');
 *
 * // Validate
 * const isValid = form.validate();
 *
 * // Submit
 * await form.submit();
 * ```
 */

import { generateUUID } from '@frontmcp/sdk/core';
import { EventBus, EventType, createEventBus, type FormEvent } from '../events';

/**
 * Field validation state
 */
export interface FieldState<T = unknown> {
  /** Field value */
  value: T;
  /** Field touched state */
  touched: boolean;
  /** Field dirty state (modified from initial) */
  dirty: boolean;
  /** Field validation errors */
  errors: string[];
  /** Field is validating */
  validating: boolean;
}

/**
 * Form validation result
 */
export interface ValidationResult {
  /** Is form valid */
  valid: boolean;
  /** Errors by field name */
  errors: Record<string, string[]>;
}

/**
 * Form state
 */
export interface FormState<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Form ID */
  id: string;
  /** Current values */
  values: T;
  /** Initial values */
  initialValues: T;
  /** Field states */
  fields: Record<keyof T, FieldState>;
  /** Form-level errors */
  errors: string[];
  /** Is form submitting */
  isSubmitting: boolean;
  /** Is form validating */
  isValidating: boolean;
  /** Is form valid */
  isValid: boolean;
  /** Is form dirty (any field modified) */
  isDirty: boolean;
  /** Is form touched (any field touched) */
  isTouched: boolean;
  /** Submit count */
  submitCount: number;
}

/**
 * Validation function type
 */
export type ValidateFn<T> = (values: T) => ValidationResult | Promise<ValidationResult>;

/**
 * Field validator function type
 */
export type FieldValidateFn<T> = (
  value: T,
  fieldName: string,
  allValues: Record<string, unknown>,
) => string[] | Promise<string[]>;

/**
 * Form state options
 */
export interface FormStateOptions<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Initial form values */
  initialValues: T;
  /** Zod schema for validation (optional) */
  schema?: {
    parse: (data: unknown) => T;
    safeParse: (data: unknown) => {
      success: boolean;
      error?: { errors: Array<{ path: (string | number)[]; message: string }> };
    };
  };
  /** Custom validation function */
  validate?: ValidateFn<T>;
  /** Field-level validators */
  fieldValidators?: Partial<Record<keyof T, FieldValidateFn<T[keyof T]>>>;
  /** Submit handler */
  onSubmit?: (values: T) => void | Promise<void>;
  /** Validate on change */
  validateOnChange?: boolean;
  /** Validate on blur */
  validateOnBlur?: boolean;
  /** Event bus for form events */
  eventBus?: EventBus;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Form state manager
 */
export class FormStateManager<T extends Record<string, unknown> = Record<string, unknown>> {
  private state: FormState<T>;
  private readonly schema?: FormStateOptions<T>['schema'];
  private readonly validateFn?: ValidateFn<T>;
  private readonly fieldValidators: Partial<Record<keyof T, FieldValidateFn<T[keyof T]>>>;
  private readonly onSubmit?: (values: T) => void | Promise<void>;
  private readonly validateOnChange: boolean;
  private readonly validateOnBlur: boolean;
  private readonly eventBus: EventBus;
  private readonly debug: boolean;
  private subscribers = new Set<(state: FormState<T>) => void>();

  constructor(options: FormStateOptions<T>) {
    this.schema = options.schema;
    this.validateFn = options.validate;
    this.fieldValidators = options.fieldValidators ?? {};
    this.onSubmit = options.onSubmit;
    this.validateOnChange = options.validateOnChange ?? true;
    this.validateOnBlur = options.validateOnBlur ?? true;
    this.eventBus = options.eventBus ?? createEventBus();
    this.debug = options.debug ?? false;

    // Initialize state
    const fields: Record<string, FieldState> = {};
    for (const key of Object.keys(options.initialValues)) {
      fields[key] = {
        value: options.initialValues[key as keyof T],
        touched: false,
        dirty: false,
        errors: [],
        validating: false,
      };
    }

    this.state = {
      id: generateUUID(),
      values: { ...options.initialValues },
      initialValues: { ...options.initialValues },
      fields: fields as Record<keyof T, FieldState>,
      errors: [],
      isSubmitting: false,
      isValidating: false,
      isValid: true,
      isDirty: false,
      isTouched: false,
      submitCount: 0,
    };
  }

  /**
   * Get current form state
   */
  getState(): Readonly<FormState<T>> {
    return this.state;
  }

  /**
   * Get form ID
   */
  get id(): string {
    return this.state.id;
  }

  /**
   * Get current values
   */
  get values(): T {
    return this.state.values;
  }

  /**
   * Get field value
   */
  getFieldValue<K extends keyof T>(fieldName: K): T[K] {
    return this.state.values[fieldName];
  }

  /**
   * Get field state
   */
  getFieldState<K extends keyof T>(fieldName: K): FieldState<T[K]> | undefined {
    return this.state.fields[fieldName] as FieldState<T[K]> | undefined;
  }

  /**
   * Set field value
   */
  async setFieldValue<K extends keyof T>(fieldName: K, value: T[K]): Promise<void> {
    const previousValue = this.state.values[fieldName];

    this.state.values[fieldName] = value;
    this.state.fields[fieldName].value = value;
    this.state.fields[fieldName].dirty = value !== this.state.initialValues[fieldName];

    this.updateDirtyState();
    this.notifySubscribers();

    this.emitEvent(EventType.FORM_FIELD_CHANGED, {
      fieldName: fieldName as string,
      fieldValue: value,
      values: this.state.values,
    });

    if (this.validateOnChange) {
      await this.validateField(fieldName);
    }

    if (this.debug) {
      console.debug(`[FormState] Field "${String(fieldName)}" changed`, { previousValue, newValue: value });
    }
  }

  /**
   * Set multiple field values
   */
  async setValues(values: Partial<T>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await this.setFieldValue(key as keyof T, value as T[keyof T]);
    }
  }

  /**
   * Touch a field (mark as touched)
   */
  async touchField<K extends keyof T>(fieldName: K): Promise<void> {
    this.state.fields[fieldName].touched = true;
    this.state.isTouched = true;
    this.notifySubscribers();

    this.emitEvent(EventType.FORM_FIELD_BLUR, {
      fieldName: fieldName as string,
      fieldValue: this.state.values[fieldName],
      values: this.state.values,
    });

    if (this.validateOnBlur) {
      await this.validateField(fieldName);
    }
  }

  /**
   * Focus a field
   */
  focusField<K extends keyof T>(fieldName: K): void {
    this.emitEvent(EventType.FORM_FIELD_FOCUS, {
      fieldName: fieldName as string,
      fieldValue: this.state.values[fieldName],
      values: this.state.values,
    });
  }

  /**
   * Validate a single field
   */
  async validateField<K extends keyof T>(fieldName: K): Promise<string[]> {
    const fieldState = this.state.fields[fieldName];
    fieldState.validating = true;
    this.notifySubscribers();

    let errors: string[] = [];

    try {
      // Field-level validator
      const fieldValidator = this.fieldValidators[fieldName];
      if (fieldValidator) {
        const fieldErrors = await fieldValidator(this.state.values[fieldName], fieldName as string, this.state.values);
        errors.push(...fieldErrors);
      }

      // Schema validation for this field
      if (this.schema) {
        const result = this.schema.safeParse(this.state.values);
        if (!result.success && result.error) {
          for (const err of result.error.errors) {
            if (err.path[0] === fieldName) {
              errors.push(err.message);
            }
          }
        }
      }
    } finally {
      fieldState.validating = false;
      fieldState.errors = errors;
      this.updateValidState();
      this.notifySubscribers();
    }

    return errors;
  }

  /**
   * Validate entire form
   */
  async validate(): Promise<ValidationResult> {
    this.state.isValidating = true;
    this.notifySubscribers();

    const errors: Record<string, string[]> = {};
    let valid = true;

    try {
      // Schema validation
      if (this.schema) {
        const result = this.schema.safeParse(this.state.values);
        if (!result.success && result.error) {
          valid = false;
          for (const err of result.error.errors) {
            const fieldName = String(err.path[0]);
            if (!errors[fieldName]) {
              errors[fieldName] = [];
            }
            errors[fieldName].push(err.message);
          }
        }
      }

      // Custom validation
      if (this.validateFn) {
        const customResult = await this.validateFn(this.state.values);
        if (!customResult.valid) {
          valid = false;
          for (const [fieldName, fieldErrors] of Object.entries(customResult.errors)) {
            if (!errors[fieldName]) {
              errors[fieldName] = [];
            }
            errors[fieldName].push(...fieldErrors);
          }
        }
      }

      // Field-level validators
      for (const [fieldName, validator] of Object.entries(this.fieldValidators)) {
        if (validator) {
          const fieldErrors = await (validator as FieldValidateFn<unknown>)(
            this.state.values[fieldName as keyof T],
            fieldName,
            this.state.values,
          );
          if (fieldErrors.length > 0) {
            valid = false;
            if (!errors[fieldName]) {
              errors[fieldName] = [];
            }
            errors[fieldName].push(...fieldErrors);
          }
        }
      }

      // Update field states
      for (const [fieldName, fieldErrors] of Object.entries(errors)) {
        if (this.state.fields[fieldName as keyof T]) {
          this.state.fields[fieldName as keyof T].errors = fieldErrors;
        }
      }

      // Clear errors for valid fields
      for (const fieldName of Object.keys(this.state.fields)) {
        if (!errors[fieldName]) {
          this.state.fields[fieldName as keyof T].errors = [];
        }
      }
    } finally {
      this.state.isValidating = false;
      this.state.isValid = valid;
      this.notifySubscribers();
    }

    this.emitEvent(EventType.FORM_VALIDATE, {
      values: this.state.values,
      errors,
      isValid: valid,
    });

    if (this.debug) {
      console.debug('[FormState] Validation result', { valid, errors });
    }

    return { valid, errors };
  }

  /**
   * Submit the form
   */
  async submit(): Promise<boolean> {
    this.state.submitCount++;
    this.state.isSubmitting = true;
    this.notifySubscribers();

    try {
      // Touch all fields
      for (const fieldName of Object.keys(this.state.fields)) {
        this.state.fields[fieldName as keyof T].touched = true;
      }
      this.state.isTouched = true;

      // Validate
      const { valid, errors } = await this.validate();

      if (!valid) {
        this.emitEvent(EventType.FORM_VALIDATE, {
          values: this.state.values,
          errors,
          isValid: false,
        });
        return false;
      }

      // Submit
      if (this.onSubmit) {
        await this.onSubmit(this.state.values);
      }

      this.emitEvent(EventType.FORM_SUBMIT, {
        values: this.state.values,
        isValid: true,
      });

      if (this.debug) {
        console.debug('[FormState] Form submitted', this.state.values);
      }

      return true;
    } catch (error) {
      this.state.errors = [(error as Error).message];
      this.notifySubscribers();
      return false;
    } finally {
      this.state.isSubmitting = false;
      this.notifySubscribers();
    }
  }

  /**
   * Reset form to initial values
   */
  reset(newInitialValues?: Partial<T>): void {
    const initialValues = newInitialValues
      ? { ...this.state.initialValues, ...newInitialValues }
      : this.state.initialValues;

    this.state.values = { ...initialValues };
    this.state.initialValues = { ...initialValues };

    for (const key of Object.keys(this.state.fields)) {
      this.state.fields[key as keyof T] = {
        value: initialValues[key as keyof T],
        touched: false,
        dirty: false,
        errors: [],
        validating: false,
      };
    }

    this.state.errors = [];
    this.state.isSubmitting = false;
    this.state.isValidating = false;
    this.state.isValid = true;
    this.state.isDirty = false;
    this.state.isTouched = false;

    this.notifySubscribers();

    this.emitEvent(EventType.FORM_RESET, {
      values: this.state.values,
    });

    if (this.debug) {
      console.debug('[FormState] Form reset');
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: (state: FormState<T>) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get the event bus
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Update dirty state
   */
  private updateDirtyState(): void {
    this.state.isDirty = Object.values(this.state.fields).some((f) => (f as FieldState).dirty);
  }

  /**
   * Update valid state
   */
  private updateValidState(): void {
    this.state.isValid = Object.values(this.state.fields).every((f) => (f as FieldState).errors.length === 0);
  }

  /**
   * Notify subscribers
   */
  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      try {
        callback(this.state);
      } catch (error) {
        console.error('[FormState] Subscriber error:', error);
      }
    }
  }

  /**
   * Emit form event
   */
  private emitEvent(type: EventType, data: Partial<Omit<FormEvent, 'type' | 'timestamp' | 'id' | 'formId'>>): void {
    this.eventBus.emit<FormEvent>(type, {
      formId: this.state.id,
      ...data,
    } as Omit<FormEvent, 'type' | 'timestamp' | 'id'>);
  }

  /**
   * Convert to JSON
   */
  toJSON(): {
    id: string;
    values: T;
    isValid: boolean;
    isDirty: boolean;
    isTouched: boolean;
    isSubmitting: boolean;
    errors: Record<string, string[]>;
  } {
    const errors: Record<string, string[]> = {};
    for (const [key, field] of Object.entries(this.state.fields)) {
      if ((field as FieldState).errors.length > 0) {
        errors[key] = (field as FieldState).errors;
      }
    }

    return {
      id: this.state.id,
      values: this.state.values,
      isValid: this.state.isValid,
      isDirty: this.state.isDirty,
      isTouched: this.state.isTouched,
      isSubmitting: this.state.isSubmitting,
      errors,
    };
  }
}

/**
 * Create a new form state manager
 */
export function createFormState<T extends Record<string, unknown>>(options: FormStateOptions<T>): FormStateManager<T> {
  return new FormStateManager(options);
}
