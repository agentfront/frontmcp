import type { JSONSchema7 } from 'json-schema';

/**
 * Helper class for building and manipulating JSON schemas
 */
export class SchemaBuilder {
  /**
   * Merge multiple schemas into one
   */
  static merge(schemas: JSONSchema7[]): JSONSchema7 {
    if (schemas.length === 0) {
      return { type: 'object' };
    }

    if (schemas.length === 1) {
      return schemas[0];
    }

    const merged: JSONSchema7 = {
      type: 'object',
      properties: {},
      required: [],
    };

    const allRequired = new Set<string>();

    for (const schema of schemas) {
      if (schema.properties) {
        merged.properties = {
          ...merged.properties,
          ...schema.properties,
        };
      }

      if (schema.required) {
        schema.required.forEach((field) => allRequired.add(field));
      }
    }

    if (allRequired.size > 0) {
      merged.required = Array.from(allRequired);
    }

    return merged;
  }

  /**
   * Create a union schema (oneOf)
   */
  static union(schemas: JSONSchema7[]): JSONSchema7 {
    if (schemas.length === 0) {
      return {};
    }

    if (schemas.length === 1) {
      return schemas[0];
    }

    return {
      oneOf: schemas,
    };
  }

  /**
   * Deep clone a schema
   */
  static clone(schema: JSONSchema7): JSONSchema7 {
    return JSON.parse(JSON.stringify(schema));
  }

  /**
   * Remove $ref from schema (assumes already dereferenced)
   */
  static removeRefs(schema: JSONSchema7): JSONSchema7 {
    const cloned = this.clone(schema);
    this.removeRefsRecursive(cloned);
    return cloned;
  }

  private static removeRefsRecursive(obj: any): void {
    if (!obj || typeof obj !== 'object') return;

    if (obj.$ref) {
      delete obj.$ref;
    }

    for (const key in obj) {
      if (key in obj) {
        const value = obj[key];
        if (value && typeof value === 'object') {
          this.removeRefsRecursive(value);
        }
      }
    }
  }

  /**
   * Add description to schema
   */
  static withDescription(schema: JSONSchema7, description: string): JSONSchema7 {
    return {
      ...schema,
      description,
    };
  }

  /**
   * Mark schema as required
   */
  static required(schema: JSONSchema7): JSONSchema7 {
    return schema;
  }

  /**
   * Mark schema as optional
   */
  static optional(schema: JSONSchema7): JSONSchema7 {
    return schema;
  }

  /**
   * Add example to schema
   */
  static withExample(schema: JSONSchema7, example: any): JSONSchema7 {
    const existingExamples = Array.isArray(schema.examples) ? schema.examples : [];
    return {
      ...schema,
      examples: [...existingExamples, example],
    };
  }

  /**
   * Add default value to schema
   */
  static withDefault(schema: JSONSchema7, defaultValue: any): JSONSchema7 {
    return {
      ...schema,
      default: defaultValue,
    };
  }

  /**
   * Add format to schema
   */
  static withFormat(schema: JSONSchema7, format: string): JSONSchema7 {
    return {
      ...schema,
      format,
    };
  }

  /**
   * Add pattern to schema
   */
  static withPattern(schema: JSONSchema7, pattern: string): JSONSchema7 {
    return {
      ...schema,
      pattern,
    };
  }

  /**
   * Add enum to schema
   */
  static withEnum(schema: JSONSchema7, values: any[]): JSONSchema7 {
    return {
      ...schema,
      enum: values,
    };
  }

  /**
   * Add minimum/maximum constraints
   */
  static withRange(
    schema: JSONSchema7,
    min?: number,
    max?: number,
    options: { exclusive?: boolean } = {}
  ): JSONSchema7 {
    const result = { ...schema };

    if (min !== undefined) {
      if (options.exclusive) {
        result.exclusiveMinimum = min;
      } else {
        result.minimum = min;
      }
    }

    if (max !== undefined) {
      if (options.exclusive) {
        result.exclusiveMaximum = max;
      } else {
        result.maximum = max;
      }
    }

    return result;
  }

  /**
   * Add minLength/maxLength constraints
   */
  static withLength(schema: JSONSchema7, minLength?: number, maxLength?: number): JSONSchema7 {
    const result = { ...schema };

    if (minLength !== undefined) {
      result.minLength = minLength;
    }

    if (maxLength !== undefined) {
      result.maxLength = maxLength;
    }

    return result;
  }

  /**
   * Create object schema
   */
  static object(
    properties: Record<string, JSONSchema7>,
    required?: string[]
  ): JSONSchema7 {
    return {
      type: 'object',
      properties,
      ...(required && required.length > 0 && { required }),
      additionalProperties: false,
    };
  }

  /**
   * Create array schema
   */
  static array(items: JSONSchema7, constraints?: {
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  }): JSONSchema7 {
    return {
      type: 'array',
      items,
      ...constraints,
    };
  }

  /**
   * Create string schema
   */
  static string(constraints?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    enum?: string[];
  }): JSONSchema7 {
    return {
      type: 'string',
      ...constraints,
    };
  }

  /**
   * Create number schema
   */
  static number(constraints?: {
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    multipleOf?: number;
  }): JSONSchema7 {
    return {
      type: 'number',
      ...constraints,
    };
  }

  /**
   * Create integer schema
   */
  static integer(constraints?: {
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    multipleOf?: number;
  }): JSONSchema7 {
    return {
      type: 'integer',
      ...constraints,
    };
  }

  /**
   * Create boolean schema
   */
  static boolean(): JSONSchema7 {
    return {
      type: 'boolean',
    };
  }

  /**
   * Create null schema
   */
  static null(): JSONSchema7 {
    return {
      type: 'null',
    };
  }

  /**
   * Flatten nested oneOf/anyOf/allOf schemas
   */
  static flatten(schema: JSONSchema7, maxDepth = 10): JSONSchema7 {
    if (maxDepth <= 0) return schema;

    const cloned = this.clone(schema);

    if (cloned.oneOf) {
      const flattened = cloned.oneOf.flatMap((s) => {
        const sub = this.flatten(s as JSONSchema7, maxDepth - 1);
        return sub.oneOf ? sub.oneOf : [sub];
      });
      cloned.oneOf = flattened as JSONSchema7[];
    }

    if (cloned.anyOf) {
      const flattened = cloned.anyOf.flatMap((s) => {
        const sub = this.flatten(s as JSONSchema7, maxDepth - 1);
        return sub.anyOf ? sub.anyOf : [sub];
      });
      cloned.anyOf = flattened as JSONSchema7[];
    }

    return cloned;
  }

  /**
   * Simplify schema by removing unnecessary fields
   */
  static simplify(schema: JSONSchema7): JSONSchema7 {
    const cloned = this.clone(schema);

    // Remove empty arrays/objects
    if (Array.isArray(cloned.required) && cloned.required.length === 0) {
      delete cloned.required;
    }

    if (cloned.properties && Object.keys(cloned.properties).length === 0) {
      delete cloned.properties;
    }

    if (Array.isArray(cloned.examples) && cloned.examples.length === 0) {
      delete cloned.examples;
    }

    // Remove title if it matches description
    if (cloned.title && cloned.description && cloned.title === cloned.description) {
      delete cloned.title;
    }

    return cloned;
  }
}
