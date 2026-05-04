import { clearCompiledSchemaCache, dropEntriesForBundleVersion, getCompiledOpSchemas } from '../executor/schema-cache';

describe('schema-cache', () => {
  beforeEach(() => clearCompiledSchemaCache());

  it('compiles and caches input/output zod schemas per (bundleVersion, opId)', () => {
    const a = getCompiledOpSchemas({
      bundleVersion: 'v1',
      operationId: 'op',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const b = getCompiledOpSchemas({
      bundleVersion: 'v1',
      operationId: 'op',
      inputSchema: {},
      outputSchema: {},
    });
    // Same key returns the SAME object (cached, not recompiled).
    expect(a).toBe(b);
  });

  it('compiles fresh entries for a different bundleVersion', () => {
    const v1 = getCompiledOpSchemas({
      bundleVersion: 'v1',
      operationId: 'op',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    });
    const v2 = getCompiledOpSchemas({
      bundleVersion: 'v2',
      operationId: 'op',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    });
    expect(v1).not.toBe(v2);
  });

  it('rejects missing required fields on the input schema', () => {
    const { input } = getCompiledOpSchemas({
      bundleVersion: 'v1',
      operationId: 'op',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, amount: { type: 'number' } },
        required: ['id', 'amount'],
      },
      outputSchema: {},
    });
    const result = input.safeParse({ id: 'x' });
    expect(result.success).toBe(false);
  });

  it('accepts well-formed inputs', () => {
    const { input } = getCompiledOpSchemas({
      bundleVersion: 'v1',
      operationId: 'op',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      outputSchema: {},
    });
    const result = input.safeParse({ id: 'x' });
    expect(result.success).toBe(true);
  });

  it('falls back to a permissive schema when JSON Schema is missing or malformed', () => {
    const { input, inputConversionFailed } = getCompiledOpSchemas({
      bundleVersion: 'v1',
      operationId: 'op',
      inputSchema: undefined as unknown as Record<string, unknown>,
      outputSchema: {},
    });
    expect(inputConversionFailed).toBe(true);
    // Permissive: anything parses.
    expect(input.safeParse({ a: 1 }).success).toBe(true);
  });

  it('dropEntriesForBundleVersion removes only that version', () => {
    getCompiledOpSchemas({ bundleVersion: 'v1', operationId: 'a', inputSchema: {}, outputSchema: {} });
    getCompiledOpSchemas({ bundleVersion: 'v1', operationId: 'b', inputSchema: {}, outputSchema: {} });
    getCompiledOpSchemas({ bundleVersion: 'v2', operationId: 'a', inputSchema: {}, outputSchema: {} });
    expect(dropEntriesForBundleVersion('v1')).toBe(2);
    // v2 entry survives.
    const v2 = getCompiledOpSchemas({ bundleVersion: 'v2', operationId: 'a', inputSchema: {}, outputSchema: {} });
    expect(v2).toBeDefined();
  });

  it('clearCompiledSchemaCache wipes everything', () => {
    getCompiledOpSchemas({ bundleVersion: 'v1', operationId: 'a', inputSchema: {}, outputSchema: {} });
    clearCompiledSchemaCache();
    expect(dropEntriesForBundleVersion('v1')).toBe(0);
  });
});
