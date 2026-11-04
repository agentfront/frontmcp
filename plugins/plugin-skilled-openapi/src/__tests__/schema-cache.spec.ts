import { getCompiledOpSchemas } from '../executor/schema-cache';

describe('schema-cache', () => {
  it('compiles an operation once, and returns the same schemas for it after', () => {
    const operation = {
      inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    };

    expect(getCompiledOpSchemas(operation)).toBe(getCompiledOpSchemas(operation));
  });

  it('compiles a changed operation afresh, even with the same bundle version and operation id', () => {
    const before = { inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, outputSchema: {} };
    const after = { inputSchema: { type: 'object', properties: { id: { type: 'number' } } }, outputSchema: {} };

    expect(getCompiledOpSchemas(before).input.safeParse({ id: 'INV-1' }).success).toBe(true);
    expect(getCompiledOpSchemas(after).input.safeParse({ id: 'INV-1' }).success).toBe(false);
    expect(getCompiledOpSchemas(before).input.safeParse({ id: 'INV-1' }).success).toBe(true);
  });

  it('rejects missing required fields on the input schema', () => {
    const { input } = getCompiledOpSchemas({
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, amount: { type: 'number' } },
        required: ['id', 'amount'],
      },
      outputSchema: {},
    });

    expect(input.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('accepts well-formed inputs', () => {
    const { input } = getCompiledOpSchemas({
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      outputSchema: {},
    });

    expect(input.safeParse({ id: 'x' }).success).toBe(true);
  });

  it('falls back to a permissive schema when JSON Schema is missing or malformed', () => {
    const { input, inputConversionFailed } = getCompiledOpSchemas({
      inputSchema: undefined as unknown as Record<string, unknown>,
      outputSchema: {},
    });

    expect(inputConversionFailed).toBe(true);
    expect(input.safeParse({ a: 1 }).success).toBe(true);
  });
});
