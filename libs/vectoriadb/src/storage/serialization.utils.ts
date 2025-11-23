import * as crypto from 'crypto';
import type { DocumentEmbedding, DocumentMetadata } from '../interfaces';
import type { SerializedEmbedding } from './adapter.interface';

/**
 * Serialize a DocumentEmbedding to a SerializedEmbedding
 * Converts Float32Array to regular array and Date to ISO string
 */
export function serializeEmbedding<T extends DocumentMetadata>(
  embedding: DocumentEmbedding<T>,
): SerializedEmbedding<T> {
  return {
    id: embedding.id,
    vector: Array.from(embedding.vector),
    metadata: embedding.metadata,
    text: embedding.text,
    createdAt: embedding.createdAt.toISOString(),
  };
}

/**
 * Deserialize a SerializedEmbedding to a DocumentEmbedding
 * Sanitizes metadata to prevent prototype pollution
 */
export function deserializeEmbedding<T extends DocumentMetadata>(
  serialized: SerializedEmbedding<T>,
): DocumentEmbedding<T> {
  // Sanitize metadata to prevent prototype pollution
  const sanitizedMetadata = sanitizeObject(serialized.metadata) as T;

  return {
    id: serialized.id,
    vector: new Float32Array(serialized.vector),
    metadata: sanitizedMetadata,
    text: serialized.text,
    createdAt: new Date(serialized.createdAt),
  };
}

/**
 * Create a hash from a string (simple implementation)
 */
export function hash(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').substring(0, 16);
}

/**
 * Create a hash from document IDs and texts
 * Used to detect when tools/documents change
 */
export function createToolsHash(documents: Array<{ id: string; text: string }>): string {
  const content = documents
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => `${d.id}:${d.text}`)
    .join('|');
  return hash(content);
}

/**
 * Sanitize an object to prevent prototype pollution
 * Creates a clean object without dangerous properties
 */
export function sanitizeObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  // Create clean object without prototype chain
  const clean: any = {};

  // Copy only safe properties
  for (const key of Object.keys(obj)) {
    // Block dangerous keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    // Recursively sanitize nested objects
    clean[key] = sanitizeObject(obj[key]);
  }

  return clean;
}
