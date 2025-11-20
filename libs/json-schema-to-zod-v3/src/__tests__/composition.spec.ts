import { convertJsonSchemaToZod } from '../converter';
import { JSONSchema } from '../types';

describe('Composition', () => {
  describe('allOf', () => {
    it('should validate that value matches all schemas', () => {
      const schema: JSONSchema = {
        allOf: [
          {
            type: 'object' as const,
            properties: { name: { type: 'string' as const } },
            required: ['name']
          },
          {
            type: 'object' as const,
            properties: { age: { type: 'number' as const } },
            required: ['age']
          }
        ]
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse({ name: 'John', age: 30 }).success).toBe(true);
      expect(zodSchema.safeParse({ name: 'John' }).success).toBe(false);
      expect(zodSchema.safeParse({ age: 30 }).success).toBe(false);
    });

    it('should handle allOf with type constraints', () => {
      const schema = {
        allOf: [
          { type: 'number' as const },
          { minimum: 0 },
          { maximum: 100 }
        ]
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse(50).success).toBe(true);
      expect(zodSchema.safeParse(-1).success).toBe(false);
      expect(zodSchema.safeParse(101).success).toBe(false);
    });
  });

  describe('anyOf', () => {
    it('should validate that value matches at least one schema', () => {
      const schema = {
        anyOf: [
          { type: 'string' as const },
          { type: 'number' as const }
        ]
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse('hello').success).toBe(true);
      expect(zodSchema.safeParse(42).success).toBe(true);
      expect(zodSchema.safeParse(true).success).toBe(false);
    });

    it('should handle anyOf with constraints', () => {
      const schema = {
        anyOf: [
          { type: 'string' as const, minLength: 10 },
          { type: 'number' as const, minimum: 100 }
        ]
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse('hello world').success).toBe(true);
      expect(zodSchema.safeParse(150).success).toBe(true);
      expect(zodSchema.safeParse('short').success).toBe(false);
      expect(zodSchema.safeParse(50).success).toBe(false);
    });
  });

  describe('oneOf', () => {
    it('should validate that value matches exactly one schema', () => {
      const schema = {
        oneOf: [
          { type: 'string' as const, minLength: 5 },
          { type: 'number' as const, minimum: 10 }
        ]
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse('hello').success).toBe(true);
      expect(zodSchema.safeParse(15).success).toBe(true);
      expect(zodSchema.safeParse('hi').success).toBe(false);
      expect(zodSchema.safeParse(5).success).toBe(false);
    });

    it('should fail when value matches multiple schemas', () => {
      const schema = {
        oneOf: [
          { type: 'number' as const },
          { type: 'number' as const, minimum: 0 }
        ]
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse(5).success).toBe(false);
      expect(zodSchema.safeParse(-5).success).toBe(true);
    });
  });

  describe('not', () => {
    it('should validate that value does not match schema', () => {
      const schema = {
        not: { type: 'null' as const }
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse('hello').success).toBe(true);
      expect(zodSchema.safeParse(42).success).toBe(true);
      expect(zodSchema.safeParse(true).success).toBe(true);
      expect(zodSchema.safeParse(null).success).toBe(false);
    });

    it('should handle not with constraints', () => {
      const schema = {
        type: 'number' as const,
        not: { minimum: 10, maximum: 20 }
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse(5).success).toBe(true);
      expect(zodSchema.safeParse(25).success).toBe(true);
      expect(zodSchema.safeParse(15).success).toBe(false);
    });
  });
});
