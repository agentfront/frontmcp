/**
 * TypedStorage Types
 *
 * Type definitions for the TypedStorage wrapper that provides
 * type-safe JSON serialization on top of StorageAdapter.
 */

import type { SetOptions } from './types';
import type { z } from 'zod';

/**
 * Options for TypedStorage wrapper
 */
export interface TypedStorageOptions<T> {
  /**
   * Optional Zod schema for validation on read.
   * If provided, values will be validated after deserialization.
   */
  schema?: z.ZodType<T>;

  /**
   * Whether to throw an error when data fails validation.
   * If false (default), returns null for invalid data.
   * @default false
   */
  throwOnInvalid?: boolean;

  /**
   * Custom serialization function.
   * @default JSON.stringify
   */
  serialize?: (value: T) => string;

  /**
   * Custom deserialization function.
   * @default JSON.parse
   */
  deserialize?: (raw: string) => unknown;
}

/**
 * Options for typed set operations.
 * Re-export for convenience.
 */
export type TypedSetOptions = SetOptions;

/**
 * Entry for batch set operations with typed values.
 */
export interface TypedSetEntry<T> {
  key: string;
  value: T;
  options?: TypedSetOptions;
}
