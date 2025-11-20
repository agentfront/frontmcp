/**
 * Utility functions for JSON Schema to Zod conversion
 */

import { z } from 'zod';

/**
 * Performs deep equality comparison between two values
 * Handles primitives, arrays, and objects recursively
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns True if values are deeply equal, false otherwise
 *
 * @example
 * deepEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] }) // true
 * deepEqual([1, 2], [1, 3]) // false
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => keysB.includes(key) && deepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * Creates a validator function that checks for unique items in an array
 * Uses deep equality comparison to detect duplicates
 *
 * @returns Validator function that returns true if all array items are unique
 *
 * @example
 * const validator = createUniqueItemsValidator();
 * validator([1, 2, 3]) // true
 * validator([1, 2, 1]) // false
 * validator([{ a: 1 }, { a: 1 }]) // false (deep equality)
 */
export function createUniqueItemsValidator(): (value: any) => boolean {
  return (value: any) => {
    if (!Array.isArray(value)) {
      return true;
    }

    const seen: any[] = [];
    return value.every((item) => {
      const isDuplicate = seen.some((seenItem) => deepEqual(item, seenItem));
      if (isDuplicate) {
        return false;
      }
      seen.push(item);
      return true;
    });
  };
}

/**
 * Validates a value against a Zod schema
 *
 * @param schema - Zod schema to validate against
 * @param value - Value to validate
 * @returns True if validation succeeds, false otherwise
 *
 * @example
 * const schema = z.string();
 * isValidWithSchema(schema, "hello") // true
 * isValidWithSchema(schema, 123) // false
 */
export function isValidWithSchema(schema: z.ZodTypeAny, value: any): boolean {
  return schema.safeParse(value).success;
}

/**
 * Checks if a value is a plain object (not an array or null)
 *
 * @param value - Value to check
 * @returns True if value is a plain object
 *
 * @example
 * isPlainObject({}) // true
 * isPlainObject([]) // false
 * isPlainObject(null) // false
 */
export function isPlainObject(value: any): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Safely gets a property from an object using Object.hasOwnProperty
 * This is more robust than simple property access for special properties
 *
 * @param obj - Object to get property from
 * @param prop - Property name
 * @returns True if property exists on object
 *
 * @example
 * hasOwnProperty({ a: 1 }, 'a') // true
 * hasOwnProperty({ a: 1 }, 'b') // false
 */
export function hasOwnProperty(obj: any, prop: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

/**
 * Checks if a property exists on an object using getOwnPropertyDescriptor
 * More reliable than 'in' operator for edge cases
 *
 * @param obj - Object to check
 * @param prop - Property name
 * @returns True if property descriptor exists
 */
export function propertyExists(obj: any, prop: string): boolean {
  return Object.getOwnPropertyDescriptor(obj, prop) !== undefined;
}
