import { z } from '@frontmcp/lazy-zod';

import { createMockOwner, createMockProviderRegistry } from '../../__test-utils__/mocks';
import { ToolContext, ToolKind, type ToolMetadata, type ToolRecord } from '../../common';
import { InvalidOutputError } from '../../errors';
import { ToolInstance } from '../tool.instance';

class AnswerTool extends ToolContext {
  async execute() {
    return {};
  }
}

function toolWithOutput(outputSchema: unknown): { tool: ToolInstance; warn: jest.Mock } {
  const providers = createMockProviderRegistry();
  const warn = providers.getActiveScope().logger.warn as jest.Mock;
  const record = {
    kind: ToolKind.CLASS_TOKEN,
    provide: AnswerTool,
    metadata: { name: 'answer', inputSchema: {}, outputSchema } as unknown as ToolMetadata,
  } as unknown as ToolRecord;
  return { tool: new ToolInstance(record, providers, createMockOwner()), warn };
}

const documentHit = z.object({ kind: z.literal('document'), title: z.string() });
const personHit = z.object({ kind: z.literal('person'), name: z.string() });

describe('ToolInstance output JSON Schema', () => {
  it('lists a union of object schemas as an object schema with anyOf', () => {
    const { tool, warn } = toolWithOutput(z.union([documentHit, personHit]));

    expect(tool.getOutputJsonSchema()).toMatchObject({
      type: 'object',
      anyOf: [
        { type: 'object', required: ['kind', 'title'] },
        { type: 'object', required: ['kind', 'name'] },
      ],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('lists a discriminated union as an object schema with oneOf', () => {
    const { tool } = toolWithOutput(z.discriminatedUnion('kind', [documentHit, personHit]));

    expect(tool.getOutputJsonSchema()).toMatchObject({
      type: 'object',
      oneOf: [{ type: 'object' }, { type: 'object' }],
    });
  });

  it('lists a union whose members are unions of object schemas', () => {
    const nested = z.union([z.union([documentHit, personHit]), z.object({ kind: z.literal('team') })]);

    expect(toolWithOutput(nested).tool.getOutputJsonSchema()).toMatchObject({ type: 'object' });
  });

  it.each([
    ['a union with a non-object member', z.union([documentHit, z.string()])],
    ['a nullable object', documentHit.nullable()],
    ['an array of objects', z.array(documentHit)],
  ])('leaves out %s and warns once, naming the tool', (_label, outputSchema) => {
    const { tool, warn } = toolWithOutput(outputSchema);

    expect(tool.getOutputJsonSchema()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"answer"');
    expect(warn.mock.calls[0][0]).toContain('not an object schema or a union of object schemas');
  });

  it('warns when the output schema cannot be converted to JSON Schema', () => {
    const { tool, warn } = toolWithOutput(z.object({ at: z.date() }));

    expect(tool.getOutputJsonSchema()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Date cannot be represented in JSON Schema');
  });

  it.each([
    ['a primitive literal', 'number'],
    ['a Zod primitive', z.string()],
    ['a Zod date', z.date()],
    ['a media literal', 'image'],
    ['a multi-content array', ['string', 'image']],
    ['an empty raw shape', {}],
    ['no output schema', undefined],
  ])('lists nothing for %s, by design and without a warning', (_label, outputSchema) => {
    const { tool, warn } = toolWithOutput(outputSchema);

    expect(tool.getOutputJsonSchema()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('ToolInstance.parseOutput and undeclared keys', () => {
  const invoiceShape = { id: z.string(), lines: z.array(z.object({ sku: z.string() })) };
  const answer = {
    id: 'INV-1',
    costCenter: 'CC-7',
    lines: [
      { sku: 'A', margin: 0.4 },
      { sku: 'B', margin: 0.1 },
    ],
  };

  it("strips undeclared keys by default and under 'strip'", () => {
    const { tool } = toolWithOutput(invoiceShape);
    const declared = { id: 'INV-1', lines: [{ sku: 'A' }, { sku: 'B' }] };

    expect(tool.parseOutput(answer).structuredContent).toEqual(declared);
    expect(tool.parseOutput(answer, { undeclaredKeys: 'strip' }).structuredContent).toEqual(declared);
  });

  it("strips under 'warn' and reports each undeclared key path once", () => {
    const { tool } = toolWithOutput(invoiceShape);
    const onUndeclaredKeys = jest.fn();

    const result = tool.parseOutput(answer, { undeclaredKeys: 'warn', onUndeclaredKeys });

    expect(result.structuredContent).toEqual({ id: 'INV-1', lines: [{ sku: 'A' }, { sku: 'B' }] });
    expect(onUndeclaredKeys).toHaveBeenCalledWith(['costCenter', 'lines[].margin']);
  });

  it("does not report under 'warn' when the answer has no undeclared key", () => {
    const { tool } = toolWithOutput(invoiceShape);
    const onUndeclaredKeys = jest.fn();

    tool.parseOutput({ id: 'INV-2', lines: [] }, { undeclaredKeys: 'warn', onUndeclaredKeys });

    expect(onUndeclaredKeys).not.toHaveBeenCalled();
  });

  it("passes undeclared keys through to structuredContent and the text under 'keep'", () => {
    const { tool } = toolWithOutput(invoiceShape);

    const result = tool.parseOutput(answer, { undeclaredKeys: 'keep' });

    expect(result.structuredContent).toEqual(answer);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(answer);
  });

  it("refuses the answer under 'fail' with InvalidOutputError naming the keys", () => {
    const { tool } = toolWithOutput(invoiceShape);

    const parsed = tool.safeParseOutput(answer, { undeclaredKeys: 'fail' });

    expect(parsed.success).toBe(false);
    const error = (parsed as { error: Error }).error;
    expect(error).toBeInstanceOf(InvalidOutputError);
    expect(error.message).toContain('costCenter, lines[].margin');
  });

  it("accepts an answer with declared keys only under 'fail'", () => {
    const { tool } = toolWithOutput(invoiceShape);

    expect(tool.safeParseOutput({ id: 'INV-2', lines: [{ sku: 'A' }] }, { undeclaredKeys: 'fail' })).toMatchObject({
      success: true,
    });
  });

  it('applies the policy to a union output schema', () => {
    const { tool } = toolWithOutput(z.union([documentHit, personHit]));
    const hit = { kind: 'person', name: 'Ada', email: 'ada@example.com' };

    expect(tool.parseOutput(hit).structuredContent).toEqual({ kind: 'person', name: 'Ada' });
    expect(tool.parseOutput(hit, { undeclaredKeys: 'keep' }).structuredContent).toEqual(hit);
  });

  it('keeps an undeclared key next to a non-finite number left for the finalize stage', () => {
    const { tool } = toolWithOutput({ ratio: z.number() });

    expect(tool.parseOutput({ ratio: Infinity, note: 'n/a' }, { undeclaredKeys: 'keep' }).structuredContent).toEqual({
      ratio: Infinity,
      note: 'n/a',
    });
  });

  describe('with a transform, whose output cannot be compared with the answer key by key', () => {
    const renamingSchema = z.object({ a: z.string() }).transform((value) => ({ renamed: value.a }));
    const droppingSchema = z
      .object({ id: z.string(), internal: z.string() })
      .transform(({ internal: _internal, ...rest }) => rest);

    it.each(['warn', 'keep', 'fail'] as const)(
      "returns the transformed output and strips an undeclared key under '%s'",
      (undeclaredKeys) => {
        const { tool } = toolWithOutput(renamingSchema);
        const onUndeclaredKeys = jest.fn();

        const result = tool.parseOutput({ a: 'x', extra: 1 }, { undeclaredKeys, onUndeclaredKeys });

        expect(result.structuredContent).toEqual({ renamed: 'x' });
        expect(onUndeclaredKeys).not.toHaveBeenCalled();
      },
    );

    it("never puts back a key the transform dropped under 'keep'", () => {
      const { tool } = toolWithOutput(droppingSchema);

      const result = tool.parseOutput({ id: '1', internal: 'secret' }, { undeclaredKeys: 'keep' });

      expect(result.structuredContent).toEqual({ id: '1' });
    });
  });
});
