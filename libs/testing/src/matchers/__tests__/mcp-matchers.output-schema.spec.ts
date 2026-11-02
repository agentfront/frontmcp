import { z } from '@frontmcp/lazy-zod';

import { mcpMatchers } from '../mcp-matchers';

import type {} from '../matcher-types';

expect.extend(mcpMatchers);

const invoiceShape = { id: z.string(), lines: z.array(z.object({ sku: z.string() })) };

describe('toPassOutputSchemaWhole', () => {
  it('passes an answer that holds declared keys only, for a raw shape', () => {
    expect({ id: 'INV-1', lines: [{ sku: 'A' }] }).toPassOutputSchemaWhole(invoiceShape);
  });

  it('passes an answer that holds declared keys only, for a Zod schema', () => {
    const hit = z.union([z.object({ title: z.string() }), z.object({ name: z.string() })]);

    expect({ name: 'Ada' }).toPassOutputSchemaWhole(hit);
  });

  it('fails an answer whose undeclared keys the schema would drop, naming them', () => {
    const answer = { id: 'INV-1', costCenter: 'CC-7', lines: [{ sku: 'A', margin: 0.4 }] };

    expect(() => expect(answer).toPassOutputSchemaWhole(invoiceShape)).toThrow(
      'drops keys it does not declare: costCenter, lines[].margin',
    );
  });

  it('fails an answer that does not match the schema, naming the first mismatch', () => {
    expect(() => expect({ id: 7, lines: [] }).toPassOutputSchemaWhole(invoiceShape)).toThrow(
      /does not match its output schema at id/,
    );
  });

  it('supports .not for an answer with undeclared keys', () => {
    expect({ id: 'INV-1', lines: [], debug: true }).not.toPassOutputSchemaWhole(invoiceShape);
  });

  it('fails .not for an answer that passes whole', () => {
    expect(() => expect({ id: 'INV-1', lines: [] }).not.toPassOutputSchemaWhole(invoiceShape)).toThrow(
      'Expected the answer not to pass its output schema whole',
    );
  });
});
