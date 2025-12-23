/**
 * Schema Paths Tests
 *
 * Tests for extracting paths from Zod schemas.
 */

import { z } from 'zod';
import {
  extractSchemaPaths,
  getSchemaPathStrings,
  isValidSchemaPath,
  getTypeAtPath,
  getPathInfo,
  getRootFieldNames,
  getTypeDescription,
} from './schema-paths';

describe('extractSchemaPaths', () => {
  it('should extract paths from a simple object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const paths = extractSchemaPaths(schema, 'output');

    expect(paths.some((p) => p.path === 'output')).toBe(true);
    expect(paths.some((p) => p.path === 'output.name')).toBe(true);
    expect(paths.some((p) => p.path === 'output.age')).toBe(true);
  });

  it('should extract paths from nested objects', () => {
    const schema = z.object({
      user: z.object({
        profile: z.object({
          name: z.string(),
        }),
      }),
    });

    const paths = extractSchemaPaths(schema, 'output');

    expect(paths.some((p) => p.path === 'output.user')).toBe(true);
    expect(paths.some((p) => p.path === 'output.user.profile')).toBe(true);
    expect(paths.some((p) => p.path === 'output.user.profile.name')).toBe(true);
  });

  it('should mark optional fields correctly', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const paths = extractSchemaPaths(schema, 'output');

    const requiredPath = paths.find((p) => p.path === 'output.required');
    const optionalPath = paths.find((p) => p.path === 'output.optional');

    expect(requiredPath?.optional).toBe(false);
    expect(optionalPath?.optional).toBe(true);
  });

  it('should mark nullable fields correctly', () => {
    const schema = z.object({
      normal: z.string(),
      nullable: z.string().nullable(),
    });

    const paths = extractSchemaPaths(schema, 'output');

    const normalPath = paths.find((p) => p.path === 'output.normal');
    const nullablePath = paths.find((p) => p.path === 'output.nullable');

    expect(normalPath?.nullable).toBe(false);
    expect(nullablePath?.nullable).toBe(true);
  });

  it('should handle array schemas with [] notation', () => {
    const schema = z.object({
      items: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
    });

    const paths = extractSchemaPaths(schema, 'output');

    expect(paths.some((p) => p.path === 'output.items')).toBe(true);
    expect(paths.some((p) => p.path === 'output.items.[]')).toBe(true);
    expect(paths.some((p) => p.path === 'output.items.[].id')).toBe(true);
    expect(paths.some((p) => p.path === 'output.items.[].name')).toBe(true);
  });

  it('should handle union schemas', () => {
    const schema = z.object({
      value: z.union([
        z.object({ type: z.literal('a'), a: z.string() }),
        z.object({ type: z.literal('b'), b: z.number() }),
      ]),
    });

    const paths = extractSchemaPaths(schema, 'output');
    const pathStrings = paths.map((p) => p.path);

    // The value path should exist
    expect(pathStrings).toContain('output.value');
    // Union paths are merged at the same path level
    // Checking that the schema structure is recognized
    expect(paths.length).toBeGreaterThan(1);
  });

  it('should use custom prefix', () => {
    const schema = z.object({ name: z.string() });

    const outputPaths = extractSchemaPaths(schema, 'output');
    const inputPaths = extractSchemaPaths(schema, 'input');

    expect(outputPaths[0].path.startsWith('output')).toBe(true);
    expect(inputPaths[0].path.startsWith('input')).toBe(true);
  });

  it('should respect maxDepth option', () => {
    const schema = z.object({
      level1: z.object({
        level2: z.object({
          level3: z.object({
            level4: z.string(),
          }),
        }),
      }),
    });

    const paths = extractSchemaPaths(schema, 'output', { maxDepth: 2 });
    const pathStrings = paths.map((p) => p.path);

    expect(pathStrings).toContain('output.level1');
    expect(pathStrings).toContain('output.level1.level2');
    expect(pathStrings).not.toContain('output.level1.level2.level3');
  });
});

describe('getSchemaPathStrings', () => {
  it('should return a Set of path strings', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const paths = getSchemaPathStrings(schema, 'output');

    expect(paths).toBeInstanceOf(Set);
    expect(paths.has('output.name')).toBe(true);
    expect(paths.has('output.age')).toBe(true);
  });
});

describe('isValidSchemaPath', () => {
  it('should return true for valid exact paths', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
      }),
    });

    expect(isValidSchemaPath(schema, 'output.user.name')).toBe(true);
  });

  it('should return false for invalid paths', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
      }),
    });

    expect(isValidSchemaPath(schema, 'output.user.email')).toBe(false);
    expect(isValidSchemaPath(schema, 'output.admin')).toBe(false);
  });

  it('should validate array index access against [] paths', () => {
    const schema = z.object({
      items: z.array(z.object({ id: z.string() })),
    });

    // Array index access should validate against the [] path
    expect(isValidSchemaPath(schema, 'output.items.0')).toBe(true);
    expect(isValidSchemaPath(schema, 'output.items.0.id')).toBe(true);
    expect(isValidSchemaPath(schema, 'output.items.0.invalid')).toBe(false);
  });
});

describe('getTypeAtPath', () => {
  it('should return the Zod type at a path', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const nameType = getTypeAtPath(schema, 'output.name');
    const ageType = getTypeAtPath(schema, 'output.age');

    expect(nameType).toBeInstanceOf(z.ZodString);
    expect(ageType).toBeInstanceOf(z.ZodNumber);
  });

  it('should return undefined for invalid paths', () => {
    const schema = z.object({ name: z.string() });

    expect(getTypeAtPath(schema, 'output.invalid')).toBeUndefined();
  });
});

describe('getPathInfo', () => {
  it('should return SchemaPath info for a path', () => {
    const schema = z.object({
      name: z.string().optional(),
    });

    const info = getPathInfo(schema, 'output.name');

    expect(info).toBeDefined();
    expect(info?.path).toBe('output.name');
    expect(info?.optional).toBe(true);
  });
});

describe('getRootFieldNames', () => {
  it('should return field names at root level', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      email: z.string(),
    });

    const names = getRootFieldNames(schema);

    expect(names).toHaveLength(3);
    expect(names).toContain('name');
    expect(names).toContain('age');
    expect(names).toContain('email');
  });

  it('should return empty array for non-object schemas', () => {
    const schema = z.string();

    expect(getRootFieldNames(schema)).toEqual([]);
  });
});

describe('getTypeDescription', () => {
  it('should describe string type', () => {
    const schema = z.object({ name: z.string() });
    expect(getTypeDescription(schema, 'output.name')).toBe('string');
  });

  it('should describe number type', () => {
    const schema = z.object({ age: z.number() });
    expect(getTypeDescription(schema, 'output.age')).toBe('number');
  });

  it('should describe boolean type', () => {
    const schema = z.object({ active: z.boolean() });
    expect(getTypeDescription(schema, 'output.active')).toBe('boolean');
  });

  it('should describe array type', () => {
    const schema = z.object({ items: z.array(z.string()) });
    expect(getTypeDescription(schema, 'output.items')).toBe('string[]');
  });

  it('should describe object type', () => {
    const schema = z.object({ data: z.object({ x: z.number() }) });
    expect(getTypeDescription(schema, 'output.data')).toBe('object');
  });

  it('should describe optional type', () => {
    const schema = z.object({ name: z.string().optional() });
    // getTypeDescription returns the unwrapped type description
    expect(getTypeDescription(schema, 'output.name')).toBe('string');
  });

  it('should describe nullable type', () => {
    const schema = z.object({ name: z.string().nullable() });
    // getTypeDescription returns the unwrapped type description
    expect(getTypeDescription(schema, 'output.name')).toBe('string');
  });

  it('should return unknown for invalid paths', () => {
    const schema = z.object({ name: z.string() });
    expect(getTypeDescription(schema, 'output.invalid')).toBe('unknown');
  });
});
