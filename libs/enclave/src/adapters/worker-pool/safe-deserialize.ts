/**
 * Safe JSON Deserialization
 *
 * Provides prototype-pollution-safe JSON parsing for worker messages.
 * All messages are JSON-serialized (not structured clone) to prevent attacks.
 *
 * @packageDocumentation
 */

import { MessageValidationError, MessageSizeError } from './errors';

/**
 * Keys that are dangerous to include in deserialized objects
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Maximum nesting depth for deserialized objects
 */
const MAX_DEPTH = 50;

/**
 * Safely deserialize a JSON string
 *
 * Security measures:
 * - Strips __proto__, constructor, prototype keys
 * - Creates null-prototype objects to prevent prototype chain attacks
 * - Enforces maximum nesting depth
 * - Enforces maximum message size
 *
 * Note: We parse first, then sanitize recursively. This ensures proper depth
 * tracking (the JSON.parse reviver processes bottom-up which makes depth
 * tracking unreliable).
 *
 * @param raw - Raw JSON string
 * @param maxSizeBytes - Maximum allowed message size (optional)
 * @returns Deserialized value
 * @throws MessageSizeError if message exceeds size limit
 * @throws MessageValidationError if JSON is invalid
 */
export function safeDeserialize(raw: string, maxSizeBytes?: number): unknown {
  // Check size limit (use actual byte length, not character count)
  if (maxSizeBytes !== undefined) {
    const byteLength = Buffer.byteLength(raw, 'utf-8');
    if (byteLength > maxSizeBytes) {
      throw new MessageSizeError(byteLength, maxSizeBytes);
    }
  }

  try {
    const parsed = JSON.parse(raw);
    // Use sanitizeObject for proper recursive depth tracking
    return sanitizeObjectWithDepthCheck(parsed, 0);
  } catch (error) {
    if (error instanceof MessageValidationError || error instanceof MessageSizeError) {
      throw error;
    }
    throw new MessageValidationError('Invalid JSON');
  }
}

/**
 * Internal sanitization with depth checking that throws on exceeded depth
 */
function sanitizeObjectWithDepthCheck(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    throw new MessageValidationError(`Message exceeds maximum depth of ${MAX_DEPTH}`);
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObjectWithDepthCheck(item, depth + 1));
  }

  // Create a null-prototype object
  const result = Object.create(null);

  for (const key of Object.keys(value as object)) {
    if (!DANGEROUS_KEYS.has(key)) {
      result[key] = sanitizeObjectWithDepthCheck((value as Record<string, unknown>)[key], depth + 1);
    }
  }

  return result;
}

/**
 * Safely serialize a value to JSON
 *
 * Strips dangerous keys before serialization.
 *
 * @param value - Value to serialize
 * @returns JSON string
 */
export function safeSerialize(value: unknown): string {
  return JSON.stringify(value, (key, val) => {
    // Strip dangerous keys
    if (DANGEROUS_KEYS.has(key)) {
      return undefined;
    }
    return val;
  });
}

/**
 * Check if a key is dangerous (would cause prototype pollution)
 */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

/**
 * Sanitize an object by removing dangerous keys recursively
 * Used for tool call arguments and results
 *
 * @param value - Value to sanitize
 * @param depth - Current recursion depth (internal)
 * @returns Sanitized value
 */
export function sanitizeObject(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return undefined;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item, depth + 1));
  }

  // Create a null-prototype object
  const result = Object.create(null);

  for (const key of Object.keys(value as object)) {
    if (!DANGEROUS_KEYS.has(key)) {
      result[key] = sanitizeObject((value as Record<string, unknown>)[key], depth + 1);
    }
  }

  return result;
}
