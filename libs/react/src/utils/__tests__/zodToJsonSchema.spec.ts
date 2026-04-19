import { z } from '@frontmcp/lazy-zod';

import { zodToJsonSchema } from '../zodToJsonSchema';

describe('zodToJsonSchema', () => {
  it('converts a z.object with string and number fields', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = zodToJsonSchema(schema);

    expect(result).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: expect.arrayContaining(['name', 'age']),
    });
  });

  it('converts a standalone z.string()', () => {
    const schema = z.string();

    const result = zodToJsonSchema(schema);

    expect(result).toMatchObject({
      type: 'string',
    });
  });

  it('converts a z.object with nested optional fields', () => {
    const schema = z.object({
      title: z.string(),
      metadata: z
        .object({
          tag: z.string().optional(),
          priority: z.number().optional(),
        })
        .optional(),
    });

    const result = zodToJsonSchema(schema);

    expect(result).toMatchObject({
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
      required: expect.arrayContaining(['title']),
    });

    // metadata should be present in properties but not in the required array
    const props = result['properties'] as Record<string, unknown>;
    expect(props['metadata']).toBeDefined();

    const required = result['required'] as string[];
    expect(required).not.toContain('metadata');
  });

  it('converts z.array of z.string', () => {
    const schema = z.array(z.string());

    const result = zodToJsonSchema(schema);

    expect(result).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('returns a plain Record<string, unknown>', () => {
    const schema = z.object({ id: z.string() });

    const result = zodToJsonSchema(schema);

    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('type');
    // Verify it behaves as a plain object (has own enumerable keys)
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });
});
