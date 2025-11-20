/**
 * Main converter module for transforming JSON Schema to Zod schemas
 *
 * This module orchestrates the conversion process by:
 * 1. Applying primitive handlers to build base type schemas
 * 2. Applying refinement handlers to add constraints and validations
 * 3. Combining multiple types into unions when necessary
 *
 * @module converter
 */

import { z } from 'zod';
import { JSONSchema, SchemaHandler, RefinementHandler, TypeRegistry } from './types';

// Import primitive handlers
import { TypeHandler, ConstHandler, EnumHandler } from './handlers/primitive/basic';
import { ImplicitStringHandler, MinLengthHandler, MaxLengthHandler, PatternHandler } from './handlers/primitive/string';
import {
  MinimumHandler,
  MaximumHandler,
  ExclusiveMinimumHandler,
  ExclusiveMaximumHandler,
  MultipleOfHandler,
} from './handlers/primitive/number';
import {
  ImplicitArrayHandler,
  MinItemsHandler,
  MaxItemsHandler,
  ItemsHandler,
  TupleHandler,
} from './handlers/primitive/array';
import {
  PropertiesHandler,
  ImplicitObjectHandler,
  MaxPropertiesHandler,
  MinPropertiesHandler,
} from './handlers/primitive/object';

// Import refinement handlers
import { AllOfHandler, AnyOfHandler, OneOfHandler, NotHandler } from './handlers/refinement/composition';
import {
  UniqueItemsHandler,
  PrefixItemsHandler,
  ContainsHandler,
  ObjectPropertiesHandler,
} from './handlers/refinement/complex';
import {
  ConstComplexHandler,
  EnumComplexHandler,
  ProtoRequiredHandler,
  DefaultHandler,
  MetadataHandler,
} from './handlers/refinement/special';

/**
 * Ordered list of primitive handlers
 * These execute first and build the base type schemas
 * Order is important - type constraints should run before other constraints
 */
const primitiveHandlers: SchemaHandler[] = [
  // Type constraints - must run first to establish allowed types
  new ConstHandler(),
  new EnumHandler(),
  new TypeHandler(),

  // Implicit type detection - must run before other constraints
  new ImplicitStringHandler(),
  new ImplicitArrayHandler(),
  new ImplicitObjectHandler(),

  // String constraints
  new MinLengthHandler(),
  new MaxLengthHandler(),
  new PatternHandler(),

  // Number constraints
  new MinimumHandler(),
  new MaximumHandler(),
  new ExclusiveMinimumHandler(),
  new ExclusiveMaximumHandler(),
  new MultipleOfHandler(),

  // Array constraints - ItemsHandler and TupleHandler set the base array type,
  // then MinItemsHandler and MaxItemsHandler apply constraints
  new TupleHandler(),
  new ItemsHandler(),
  new MinItemsHandler(),
  new MaxItemsHandler(),

  // Object constraints
  new MaxPropertiesHandler(),
  new MinPropertiesHandler(),
  new PropertiesHandler(),
];

/**
 * Ordered list of refinement handlers
 * These execute second and add refinements to the base schemas
 * Order is important - special cases should run before general refinements
 */
const refinementHandlers: RefinementHandler[] = [
  // Handle special cases first
  new ProtoRequiredHandler(),
  new EnumComplexHandler(),
  new ConstComplexHandler(),

  // Logical combinations
  new AllOfHandler(),
  new AnyOfHandler(),
  new OneOfHandler(),

  // Type-specific refinements
  new PrefixItemsHandler(),
  new ObjectPropertiesHandler(),

  // Array refinements
  new ContainsHandler(),

  // Other refinements
  new NotHandler(),
  new UniqueItemsHandler(),
  new DefaultHandler(),

  // Metadata last (doesn't affect validation)
  new MetadataHandler(),
];

/**
 * Converts a JSON Schema to a Zod schema
 *
 * This is the main entry point for conversion. It handles:
 * - Boolean schemas (true/false)
 * - Single-type schemas
 * - Multi-type schemas (unions)
 * - All JSON Schema constraints and keywords
 *
 * @param schema - JSON Schema to convert (object or boolean)
 * @returns Zod schema equivalent to the input JSON Schema
 *
 * @example
 * // Simple string schema
 * const schema = { type: "string", minLength: 5 };
 * const zodSchema = convertJsonSchemaToZod(schema);
 *
 * @example
 * // Complex object schema
 * const schema = {
 *   type: "object",
 *   properties: {
 *     name: { type: "string" },
 *     age: { type: "number", minimum: 0 }
 *   },
 *   required: ["name"]
 * };
 * const zodSchema = convertJsonSchemaToZod(schema);
 *
 * @example
 * // Boolean schemas
 * convertJsonSchemaToZod(true) // z.any() - allows anything
 * convertJsonSchemaToZod(false) // z.never() - allows nothing
 */
export function convertJsonSchemaToZod(schema: JSONSchema): z.ZodTypeAny {
  // Handle boolean schemas
  if (typeof schema === 'boolean') {
    return schema ? z.any() : z.never();
  }

  // Initialize type registry
  const types: TypeRegistry = {};

  // Phase 1: Apply primitive handlers to build base type schemas
  for (const handler of primitiveHandlers) {
    handler.apply(types, schema);
  }

  // Phase 2: Collect all allowed type schemas
  const allowedSchemas: z.ZodTypeAny[] = [];

  if (types.string !== false) {
    allowedSchemas.push(types.string || z.string());
  }
  if (types.number !== false) {
    allowedSchemas.push(types.number || z.number());
  }
  if (types.boolean !== false) {
    allowedSchemas.push(types.boolean || z.boolean());
  }
  if (types.null !== false) {
    allowedSchemas.push(types.null || z.null());
  }
  if (types.array !== false) {
    allowedSchemas.push(types.array || z.array(z.any()));
  }
  if (types.tuple !== false && types.tuple !== undefined) {
    allowedSchemas.push(types.tuple);
  }
  if (types.object !== false) {
    if (types.object) {
      allowedSchemas.push(types.object);
    } else {
      // Create a custom validator for plain objects
      const objectSchema = z.custom(
        (val) => typeof val === 'object' && val !== null && !Array.isArray(val),
        'Must be an object, not an array',
      );
      allowedSchemas.push(objectSchema);
    }
  }

  // Phase 3: Combine schemas or return never
  let zodSchema: z.ZodTypeAny;

  if (allowedSchemas.length === 0) {
    zodSchema = z.never();
  } else if (allowedSchemas.length === 1) {
    zodSchema = allowedSchemas[0];
  } else {
    // Multiple types allowed - check if we should use union or any
    const hasConstraints = Object.keys(schema).some(
      (key) => key !== '$schema' && key !== 'title' && key !== 'description',
    );

    if (!hasConstraints) {
      // No constraints - use any() for maximum flexibility
      zodSchema = z.any();
    } else {
      // Has constraints - use union to validate against all possible types
      zodSchema = z.union(allowedSchemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    }
  }

  // Phase 4: Apply refinement handlers to add constraints
  for (const handler of refinementHandlers) {
    zodSchema = handler.apply(zodSchema, schema);
  }

  return zodSchema;
}
