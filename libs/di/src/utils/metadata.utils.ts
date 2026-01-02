/**
 * Metadata utilities for dependency injection.
 *
 * These utilities work with reflect-metadata to store and retrieve
 * DI-related metadata on classes.
 */

import 'reflect-metadata';
import type { Type } from '../interfaces/base.interface.js';
import { META_ASYNC_WITH } from '../tokens/di.constants.js';

/**
 * Get metadata value from a target.
 *
 * @param key - The metadata key
 * @param target - The target object or class
 * @param propertyKey - Optional property key for method/property metadata
 * @returns The metadata value or undefined
 */
export function getMetadata<T = any>(key: any, target: any, propertyKey?: string | symbol): T | undefined {
  return propertyKey !== undefined ? Reflect.getMetadata(key, target, propertyKey) : Reflect.getMetadata(key, target);
}

/**
 * Set metadata value on a target.
 *
 * @param key - The metadata key
 * @param value - The metadata value
 * @param target - The target object or class
 * @param propertyKey - Optional property key for method/property metadata
 */
export function setMetadata(key: any, value: any, target: any, propertyKey?: string | symbol): void {
  if (propertyKey !== undefined) {
    Reflect.defineMetadata(key, value, target, propertyKey);
  } else {
    Reflect.defineMetadata(key, value, target);
  }
}

/**
 * Check if a class uses async initialization via static `with()` method.
 *
 * Classes decorated with @AsyncWith will have this metadata set and
 * should be instantiated using their static `with()` method instead
 * of the constructor.
 *
 * @param klass - The class to check
 * @returns True if the class uses async initialization
 */
export function hasAsyncWith(klass: Type<any>): boolean {
  return !!getMetadata(META_ASYNC_WITH, klass);
}
