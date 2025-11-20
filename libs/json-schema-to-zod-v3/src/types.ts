/**
 * Type definitions for JSON Schema to Zod converter
 */

import { z } from 'zod';

/**
 * Represents any valid JSON Schema value
 */
export type JSONSchema = boolean | JSONSchemaObject;

/**
 * JSON Schema object definition supporting Draft 7+ features
 */
export interface JSONSchemaObject {
  // Core keywords
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  default?: any;

  // Type keywords
  type?: JSONSchemaType | JSONSchemaType[];
  enum?: any[];
  const?: any;

  // String keywords
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // Number keywords
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;

  // Array keywords
  items?: JSONSchema | JSONSchema[];
  prefixItems?: JSONSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  contains?: JSONSchema;
  minContains?: number;
  maxContains?: number;

  // Object keywords
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  minProperties?: number;
  maxProperties?: number;

  // Composition keywords
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;

  // Allow additional properties
  [key: string]: any;
}

/**
 * Valid JSON Schema primitive type names
 */
export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'array' | 'object';

/**
 * Internal type registry used during schema conversion
 */
export interface TypeRegistry {
  string?: z.ZodTypeAny | false;
  number?: z.ZodTypeAny | false;
  boolean?: z.ZodTypeAny | false;
  null?: z.ZodTypeAny | false;
  array?: z.ZodTypeAny | false;
  object?: z.ZodTypeAny | false;
  tuple?: z.ZodTypeAny | false;
}

/**
 * Handler interface for processing JSON Schema constraints
 */
export interface SchemaHandler {
  /**
   * Apply the handler's logic to the schema
   * @param types - Current type registry
   * @param schema - JSON Schema object being processed
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void;
}

/**
 * Handler interface for applying refinements to Zod schemas
 */
export interface RefinementHandler {
  /**
   * Apply refinements to an existing Zod schema
   * @param zodSchema - Current Zod schema
   * @param schema - Original JSON Schema object
   * @returns Modified Zod schema with refinements applied
   */
  apply(zodSchema: z.ZodTypeAny, schema: JSONSchemaObject): z.ZodTypeAny;
}
