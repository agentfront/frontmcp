/**
 * Tests for extendOutputSchemaForElicitation.
 *
 * Verifies that extended schemas always have type: 'object' at the top level,
 * which is required by the MCP spec's ToolSchema for outputSchema.
 */
import { extendOutputSchemaForElicitation } from '../extend-output-schema';
import { ELICITATION_FALLBACK_JSON_SCHEMA } from '../../elicitation-fallback.schema';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';

describe('extendOutputSchemaForElicitation', () => {
  const standardSchema: Record<string, unknown> = {
    type: 'object',
    properties: { result: { type: 'string' } },
    required: ['result'],
  };

  describe('with a standard original schema', () => {
    it('should return schema with type: "object" at top level', () => {
      const result = extendOutputSchemaForElicitation(standardSchema);
      expect(result['type']).toBe('object');
    });

    it('should wrap in oneOf with original and fallback', () => {
      const result = extendOutputSchemaForElicitation(standardSchema);
      expect(result['oneOf']).toEqual([standardSchema, ELICITATION_FALLBACK_JSON_SCHEMA]);
    });

    it('should have exactly 2 items in oneOf', () => {
      const result = extendOutputSchemaForElicitation(standardSchema);
      expect((result['oneOf'] as unknown[]).length).toBe(2);
    });
  });

  describe('with no original schema (undefined)', () => {
    it('should return schema with type: "object" at top level', () => {
      const result = extendOutputSchemaForElicitation(undefined);
      expect(result['type']).toBe('object');
    });

    it('should use anyOf with generic object and fallback', () => {
      const result = extendOutputSchemaForElicitation(undefined);
      expect(result['anyOf']).toEqual([
        { type: 'object', additionalProperties: true },
        ELICITATION_FALLBACK_JSON_SCHEMA,
      ]);
    });
  });

  describe('with original schema that has existing oneOf', () => {
    const schemaWithOneOf: Record<string, unknown> = {
      type: 'object',
      oneOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    };

    it('should return schema with type: "object" at top level', () => {
      const result = extendOutputSchemaForElicitation(schemaWithOneOf);
      expect(result['type']).toBe('object');
    });

    it('should append fallback to existing oneOf', () => {
      const result = extendOutputSchemaForElicitation(schemaWithOneOf);
      const oneOf = result['oneOf'] as unknown[];
      expect(oneOf.length).toBe(3);
      expect(oneOf[2]).toEqual(ELICITATION_FALLBACK_JSON_SCHEMA);
    });

    it('should preserve existing oneOf items', () => {
      const result = extendOutputSchemaForElicitation(schemaWithOneOf);
      const oneOf = result['oneOf'] as Record<string, unknown>[];
      expect(oneOf[0]).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
      expect(oneOf[1]).toEqual({ type: 'object', properties: { b: { type: 'number' } } });
    });
  });

  describe('idempotency — schema already has elicitation fallback', () => {
    const schemaWithFallback: Record<string, unknown> = {
      type: 'object',
      oneOf: [standardSchema, ELICITATION_FALLBACK_JSON_SCHEMA],
    };

    it('should return schema with type: "object" at top level', () => {
      const result = extendOutputSchemaForElicitation(schemaWithFallback);
      expect(result['type']).toBe('object');
    });

    it('should not duplicate the fallback', () => {
      const result = extendOutputSchemaForElicitation(schemaWithFallback);
      const oneOf = result['oneOf'] as unknown[];
      expect(oneOf.length).toBe(2);
    });
  });

  describe('edge case — oneOf without type: "object" in original', () => {
    const schemaWithoutType: Record<string, unknown> = {
      oneOf: [{ type: 'object', properties: { x: { type: 'string' } } }],
    };

    it('should add type: "object" even when original lacks it', () => {
      const result = extendOutputSchemaForElicitation(schemaWithoutType);
      expect(result['type']).toBe('object');
    });
  });

  describe('MCP SDK ToolSchema compatibility', () => {
    function buildToolDescriptor(outputSchema: Record<string, unknown>) {
      return {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' as const, properties: {} },
        outputSchema,
      };
    }

    it('should pass ToolSchema.parse() with extended standard schema', () => {
      const extended = extendOutputSchemaForElicitation(standardSchema);
      const descriptor = buildToolDescriptor(extended);
      expect(() => ToolSchema.parse(descriptor)).not.toThrow();
    });

    it('should pass ToolSchema.parse() with extended undefined schema', () => {
      const extended = extendOutputSchemaForElicitation(undefined);
      const descriptor = buildToolDescriptor(extended);
      expect(() => ToolSchema.parse(descriptor)).not.toThrow();
    });

    it('should pass ToolSchema.parse() with extended oneOf schema', () => {
      const schemaWithOneOf: Record<string, unknown> = {
        type: 'object',
        oneOf: [{ type: 'object', properties: { a: { type: 'string' } } }],
      };
      const extended = extendOutputSchemaForElicitation(schemaWithOneOf);
      const descriptor = buildToolDescriptor(extended);
      expect(() => ToolSchema.parse(descriptor)).not.toThrow();
    });

    it('should pass ToolSchema.parse() with idempotent schema', () => {
      const schemaWithFallback: Record<string, unknown> = {
        type: 'object',
        oneOf: [standardSchema, ELICITATION_FALLBACK_JSON_SCHEMA],
      };
      const extended = extendOutputSchemaForElicitation(schemaWithFallback);
      const descriptor = buildToolDescriptor(extended);
      expect(() => ToolSchema.parse(descriptor)).not.toThrow();
    });
  });
});
