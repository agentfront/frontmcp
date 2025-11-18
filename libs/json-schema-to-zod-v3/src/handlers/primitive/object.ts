/**
 * Handlers for JSON Schema object constraints
 */

import { z } from 'zod';
import { SchemaHandler, TypeRegistry, JSONSchemaObject } from '../../types';

/**
 * Handles basic object properties setup
 * Initializes an object type when properties, required, or additionalProperties are present
 */
export class PropertiesHandler implements SchemaHandler {
  /**
   * Initializes an object type if object-defining keywords are present
   * Creates a passthrough object (allows additional properties by default)
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema to check for object keywords
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (types.object === false) return;

    if (schema.properties ||
      schema.required ||
      schema.additionalProperties !== undefined) {
      types.object = types.object || z.object({}).passthrough();
    }
  }
}

/**
 * Detects an implicit object type from object-specific constraints
 * If minProperties or maxProperties are present without an explicit type, infer an object type
 */
export class ImplicitObjectHandler implements SchemaHandler {
  /**
   * Checks if object constraints are present without explicit type declaration
   * Initializes an object type if object-specific keywords are found
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema to check for object constraints
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.type === undefined &&
      (schema.maxProperties !== undefined ||
        schema.minProperties !== undefined)) {
      if (types.object === undefined) {
        types.object = z.object({}).passthrough();
      }
    }
  }
}

/**
 * Handles the 'maxProperties' constraint for objects
 * Limits the maximum number of properties an object can have
 */
export class MaxPropertiesHandler implements SchemaHandler {
  /**
   * Applies maximum properties constraint to the object type
   * Uses refinement to count object keys
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing maxProperties
   *
   * @example
   * { "type": "object", "maxProperties": 5 } // At most 5 properties
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.maxProperties === undefined) return;
    if (types.object === false) return;

    const baseObject = types.object || z.object({}).passthrough();
    types.object = baseObject.refine(
      (obj) => Object.keys(obj).length <= schema.maxProperties!,
      { message: `Object must have at most ${schema.maxProperties} properties` }
    );
  }
}

/**
 * Handles the 'minProperties' constraint for objects
 * Requires a minimum number of properties in an object
 */
export class MinPropertiesHandler implements SchemaHandler {
  /**
   * Applies minimum properties constraint to object type
   * Uses refinement to count object keys
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing minProperties
   *
   * @example
   * { "type": "object", "minProperties": 1 } // At least 1 property required
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.minProperties === undefined) return;
    if (types.object === false) return;

    const baseObject = types.object || z.object({}).passthrough();
    types.object = baseObject.refine(
      (obj) => Object.keys(obj).length >= schema.minProperties!,
      { message: `Object must have at least ${schema.minProperties} properties` }
    );
  }
}
