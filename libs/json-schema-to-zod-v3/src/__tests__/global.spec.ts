import { convertJsonSchemaToZod } from '../converter';

describe('Bug Fixes and Real World Scenarios', () => {
  describe('Nested Object Properties Bug Fix', () => {
    it('should handle nested object with properties and descriptions', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          requestBody: {
            type: 'object' as const,
            required: ['email', 'password'],
            properties: {
              email: {
                type: 'string' as const,
                description: 'Registered email address'
              },
              password: {
                type: 'string' as const,
                description: 'Account password'
              }
            },
            description: 'The JSON request body.'
          }
        },
        required: ['requestBody']
      };

      const zodSchema = convertJsonSchemaToZod(schema);

      // Valid case
      expect(zodSchema.safeParse({
        requestBody: {
          email: 'test@example.com',
          password: 'secret123'
        }
      }).success).toBe(true);

      // Missing email
      expect(zodSchema.safeParse({
        requestBody: {
          password: 'secret123'
        }
      }).success).toBe(false);

      // Missing password
      expect(zodSchema.safeParse({
        requestBody: {
          email: 'test@example.com'
        }
      }).success).toBe(false);

      // Missing requestBody
      expect(zodSchema.safeParse({}).success).toBe(false);

      // Wrong type
      expect(zodSchema.safeParse({
        requestBody: {
          email: 123,
          password: 'secret123'
        }
      }).success).toBe(false);
    });

    it('should handle deeply nested objects', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          user: {
            type: 'object' as const,
            properties: {
              profile: {
                type: 'object' as const,
                properties: {
                  name: { type: 'string' as const },
                  age: { type: 'number' as const }
                },
                required: ['name']
              }
            },
            required: ['profile']
          }
        },
        required: ['user']
      };

      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse({
        user: {
          profile: {
            name: 'John',
            age: 30
          }
        }
      }).success).toBe(true);

      expect(zodSchema.safeParse({
        user: {
          profile: {
            age: 30
          }
        }
      }).success).toBe(false);
    });
  });

  describe('Real World Scenarios', () => {
    it('should handle user registration schema', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          username: {
            type: 'string' as const,
            minLength: 3,
            maxLength: 20,
            pattern: '^[a-zA-Z0-9_]+$'
          },
          email: {
            type: 'string' as const,
            pattern: '^[^@]+@[^@]+\\.[^@]+$'
          },
          password: {
            type: 'string' as const,
            minLength: 8
          },
          age: {
            type: 'number' as const,
            minimum: 13,
            maximum: 120
          },
          terms: {
            type: 'boolean' as const,
            const: true
          }
        },
        required: ['username', 'email', 'password', 'terms']
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse({
        username: 'john_doe',
        email: 'john@example.com',
        password: 'secure123',
        age: 25,
        terms: true
      }).success).toBe(true);

      expect(zodSchema.safeParse({
        username: 'jd',
        email: 'john@example.com',
        password: 'secure123',
        terms: true
      }).success).toBe(false);
    });

    it('should handle API response schema', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          status: {
            type: 'string' as const,
            enum: ['success', 'error']
          },
          data: {
            anyOf: [
              { type: 'object' as const },
              { type: 'array' as const },
              { type: 'null' as const }
            ]
          },
          error: {
            type: 'object' as const,
            properties: {
              code: { type: 'string' as const },
              message: { type: 'string' as const }
            }
          }
        },
        required: ['status']
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse({
        status: 'success',
        data: { id: 1, name: 'Item' }
      }).success).toBe(true);

      expect(zodSchema.safeParse({
        status: 'error',
        error: { code: 'ERR_001', message: 'Something went wrong' }
      }).success).toBe(true);

      expect(zodSchema.safeParse({
        status: 'pending'
      }).success).toBe(false);
    });

    it('should handle product catalog schema', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          name: { type: 'string' as const, minLength: 1 },
          price: {
            type: 'number' as const,
            minimum: 0,
            multipleOf: 0.01
          },
          category: {
            type: 'string' as const,
            enum: ['electronics', 'clothing', 'books']
          },
          tags: {
            type: 'array' as const,
            items: { type: 'string' as const },
            uniqueItems: true,
            minItems: 1
          },
          inStock: { type: 'boolean' as const },
          metadata: {
            type: 'object' as const,
            properties: {
              createdAt: { type: 'string' as const },
              updatedAt: { type: 'string' as const }
            },
            required: ['createdAt']
          }
        },
        required: ['id', 'name', 'price', 'category']
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse({
        id: 'prod-123',
        name: 'Laptop',
        price: 999.99,
        category: 'electronics',
        tags: ['new', 'featured'],
        inStock: true,
        metadata: {
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02'
        }
      }).success).toBe(true);

      expect(zodSchema.safeParse({
        id: 'prod-123',
        name: 'Laptop',
        price: 999.995,
        category: 'electronics'
      }).success).toBe(false);
    });

    it('should handle OpenAPI-style parameter schema', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'integer' as const,
            minimum: 1,
            maximum: 100,
            default: 10
          },
          offset: {
            type: 'integer' as const,
            minimum: 0,
            default: 0
          },
          sort: {
            type: 'string' as const,
            enum: ['asc', 'desc'],
            default: 'asc'
          },
          filter: {
            type: 'object' as const,
            properties: {
              status: {
                type: 'string' as const,
                enum: ['active', 'inactive', 'pending']
              },
              category: {
                type: 'string' as const
              }
            }
          }
        }
      };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse({
        limit: 20,
        offset: 0,
        sort: 'desc',
        filter: {
          status: 'active',
          category: 'electronics'
        }
      }).success).toBe(true);

      expect(zodSchema.safeParse({
        limit: 20.5
      }).success).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty schemas', () => {
      const schema = {};
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse('anything').success).toBe(true);
      expect(zodSchema.safeParse(42).success).toBe(true);
      expect(zodSchema.safeParse({ a: 1 }).success).toBe(true);
    });

    it('should handle empty enum', () => {
      const schema = { enum: [] };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse('anything').success).toBe(false);
      expect(zodSchema.safeParse(123).success).toBe(false);
    });

    it('should handle implicit type detection with string constraints', () => {
      // When only minLength is present without explicit type,
      // the schema accepts multiple types but applies string validation when it's a string
      const schema = { minLength: 5 };
      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse('hello').success).toBe(true);
      expect(zodSchema.safeParse('hi').success).toBe(false);
      // Note: Without explicit type, other types are also allowed
      // To enforce only strings, use: { type: 'string', minLength: 5 }
    });
  });
});
