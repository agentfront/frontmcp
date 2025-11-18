/**
 * Handlers for primitive JSON Schema type constraints
 * These handlers process basic type definitions and constraints
 */

import { z } from 'zod';
import { SchemaHandler, TypeRegistry, JSONSchemaObject } from '../../types';

/**
 * Handles the 'type' keyword in JSON Schema
 * Sets which primitive types are allowed and configures integer constraints
 */
export class TypeHandler implements SchemaHandler {
  /**
   * Applies type constraints from JSON Schema to the type registry
   * Disables types not specified in the schema and applies integer constraint for numbers
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing type definition
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (!schema.type) return;

    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const typeSet = new Set(allowedTypes);

    // Disable types that aren't explicitly allowed
    if (!typeSet.has('string')) types.string = false;
    if (!typeSet.has('number') && !typeSet.has('integer')) types.number = false;
    if (!typeSet.has('boolean')) types.boolean = false;
    if (!typeSet.has('null')) types.null = false;
    if (!typeSet.has('array')) types.array = false;
    if (!typeSet.has('object')) types.object = false;

    // Apply integer constraint to numbers
    if (typeSet.has('integer') && types.number !== false) {
      const currentNumber = types.number || z.number();
      if (currentNumber instanceof z.ZodNumber) {
        types.number = currentNumber.int();
      }
    }
  }
}

/**
 * Handles the 'const' keyword in JSON Schema
 * Restricts values to exactly one constant value
 */
export class ConstHandler implements SchemaHandler {
  /**
   * Applies const constraint - only allows the specified literal value
   * Disables all types except the one matching the const value
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing const definition
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (schema.const === undefined) return;

    const constValue = schema.const;

    // Disable all types initially
    types.string = false;
    types.number = false;
    types.boolean = false;
    types.null = false;
    types.array = false;
    types.object = false;

    // Enable only the matching type with literal value
    if (typeof constValue === 'string') {
      types.string = z.literal(constValue);
    } else if (typeof constValue === 'number') {
      types.number = z.literal(constValue);
    } else if (typeof constValue === 'boolean') {
      types.boolean = z.literal(constValue);
    } else if (constValue === null) {
      types.null = z.null();
    } else if (Array.isArray(constValue)) {
      types.array = undefined; // Complex arrays handled by refinement
    } else if (typeof constValue === 'object') {
      types.object = undefined; // Complex objects handled by refinement
    }
  }
}

/**
 * Handles the 'enum' keyword in JSON Schema
 * Restricts values to one of the enumerated values
 */
export class EnumHandler implements SchemaHandler {
  /**
   * Applies enum constraint - creates literal or enum schemas for each type
   * Groups enum values by type and creates appropriate Zod schemas
   *
   * @param types - Type registry to modify
   * @param schema - JSON Schema containing enum definition
   */
  apply(types: TypeRegistry, schema: JSONSchemaObject): void {
    if (!schema.enum) return;

    // Empty enum means no values are valid
    if (schema.enum.length === 0) {
      if (!schema.type) {
        types.string = false;
        types.number = false;
        types.boolean = false;
        types.null = false;
        types.array = false;
        types.object = false;
      }
      return;
    }

    // Group enum values by their type
    const valuesByType = {
      string: schema.enum.filter((v) => typeof v === 'string'),
      number: schema.enum.filter((v) => typeof v === 'number'),
      boolean: schema.enum.filter((v) => typeof v === 'boolean'),
      null: schema.enum.filter((v) => v === null),
      array: schema.enum.filter((v) => Array.isArray(v)),
      object: schema.enum.filter((v) => typeof v === 'object' && v !== null && !Array.isArray(v)),
    };

    types.string = this.createTypeSchema(valuesByType.string, 'string');
    types.number = this.createTypeSchema(valuesByType.number, 'number');
    types.boolean = this.createTypeSchema(valuesByType.boolean, 'boolean');
    types.null = valuesByType.null.length > 0 ? z.null() : false;
    types.array = valuesByType.array.length > 0 ? undefined : false;
    types.object = valuesByType.object.length > 0 ? undefined : false;
  }

  /**
   * Creates a Zod schema for a specific type's enum values
   *
   * @param values - Array of enum values of the same type
   * @param type - The type of values ('string', 'number', or 'boolean')
   * @returns Zod schema or false if no values
   */
  private createTypeSchema(values: any[], type: 'string' | 'number' | 'boolean'): z.ZodTypeAny | false {
    if (values.length === 0) return false;
    if (values.length === 1) return z.literal(values[0]);

    if (type === 'string') {
      return z.enum(values as [string, ...string[]]);
    }

    if (type === 'number') {
      const [first, second, ...rest] = values;
      return z.union([z.literal(first), z.literal(second), ...rest.map((v) => z.literal(v))]);
    }

    if (type === 'boolean') {
      return z.union([z.literal(true), z.literal(false)]);
    }

    return false;
  }
}
