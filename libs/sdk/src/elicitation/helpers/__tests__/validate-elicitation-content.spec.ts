/**
 * Tests for elicitation content validation helper.
 */
import { validateElicitationContent } from '../validate-elicitation-content';

describe('validateElicitationContent', () => {
  describe('valid content', () => {
    it('should validate content that matches a simple schema', () => {
      const content = { name: 'John', age: 30 };
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate content with optional fields', () => {
      const content = { name: 'John' };
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });

    it('should validate content with nested objects', () => {
      const content = {
        user: { name: 'John', email: 'john@example.com' },
        settings: { notifications: true },
      };
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
            },
            required: ['name', 'email'],
          },
          settings: {
            type: 'object',
            properties: {
              notifications: { type: 'boolean' },
            },
          },
        },
        required: ['user'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });

    it('should validate content with arrays', () => {
      const content = { tags: ['red', 'blue', 'green'] };
      const schema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['tags'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });

    it('should validate boolean values', () => {
      const content = { confirmed: true };
      const schema = {
        type: 'object',
        properties: {
          confirmed: { type: 'boolean' },
        },
        required: ['confirmed'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });

    it('should validate enum values', () => {
      const content = { status: 'approved' };
      const schema = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected'],
          },
        },
        required: ['status'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });
  });

  describe('invalid content', () => {
    it('should reject content with wrong type', () => {
      const content = { name: 'John', age: 'thirty' }; // age should be number
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should reject content missing required fields', () => {
      const content = { name: 'John' }; // missing required 'age'
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject invalid enum values', () => {
      const content = { status: 'invalid_status' };
      const schema = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected'],
          },
        },
        required: ['status'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject nested object with invalid structure', () => {
      const content = {
        user: { name: 'John' }, // missing required 'email'
      };
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
            },
            required: ['name', 'email'],
          },
        },
        required: ['user'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject array with wrong item types', () => {
      const content = { tags: ['red', 123, 'green'] }; // 123 should be string
      const schema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['tags'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('error format', () => {
    it('should return errors with path and message', () => {
      const content = { name: 123 }; // name should be string
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toHaveProperty('path');
      expect(result.errors![0]).toHaveProperty('message');
      expect(Array.isArray(result.errors![0].path)).toBe(true);
      expect(typeof result.errors![0].message).toBe('string');
    });

    it('should include correct path for nested errors', () => {
      const content = {
        user: { name: 'John', age: 'invalid' },
      };
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' },
            },
            required: ['name', 'age'],
          },
        },
        required: ['user'],
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      // The error path should include the nested path
      const errorPaths = result.errors!.map((e) => e.path.join('.'));
      expect(errorPaths.some((p) => p.includes('user') || p.includes('age'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty object schema', () => {
      const content = {};
      const schema = {
        type: 'object',
        properties: {},
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });

    it('should handle null content when schema allows null', () => {
      const content = null;
      const schema = {
        type: 'null',
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });

    it('should handle primitive string content', () => {
      const content = 'just a string';
      const schema = {
        type: 'string',
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });

    it('should handle primitive number content', () => {
      const content = 42;
      const schema = {
        type: 'number',
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });

    it('should handle primitive boolean content', () => {
      const content = true;
      const schema = {
        type: 'boolean',
      };

      const result = validateElicitationContent(content, schema);

      expect(result.success).toBe(true);
    });
  });
});
