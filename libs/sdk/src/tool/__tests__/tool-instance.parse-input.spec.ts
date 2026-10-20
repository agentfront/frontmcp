import { z } from '@frontmcp/lazy-zod';

import { createMockOwner, createMockProviderRegistry } from '../../__test-utils__/mocks';
import { ToolContext, ToolKind, type ToolMetadata, type ToolRecord } from '../../common';
import { ToolInstance } from '../tool.instance';

class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return input.a + input.b;
  }
}

function addTool(metadata: Partial<ToolMetadata> = {}): ToolInstance {
  const record = {
    kind: ToolKind.CLASS_TOKEN,
    provide: AddTool,
    metadata: { name: 'add', inputSchema: { a: z.number(), b: z.number() }, ...metadata },
  } as unknown as ToolRecord;
  return new ToolInstance(record, createMockProviderRegistry(), createMockOwner());
}

const builtSchema = (tool: ToolInstance) =>
  (tool as unknown as { _inputObjectSchema?: { schema: unknown } })._inputObjectSchema?.schema;

describe('ToolInstance.parseInput', () => {
  it('validates the arguments and strips unknown keys on every call', () => {
    const tool = addTool();
    expect(tool.parseInput({ name: 'add', arguments: { a: 2, b: 3, extra: true } })).toEqual({ a: 2, b: 3 });
    expect(tool.parseInput({ name: 'add', arguments: { a: 1.5, b: -4 } })).toEqual({ a: 1.5, b: -4 });
    expect(() => tool.parseInput({ name: 'add', arguments: { a: '2', b: 3 } })).toThrow(z.ZodError);
    expect(() => tool.parseInput({ name: 'add', arguments: { a: 2 } })).toThrow(z.ZodError);
  });

  it('reports the same issues as z.object(inputSchema)', () => {
    const tool = addTool();
    const args = { a: '2' };
    const expected = z.object({ a: z.number(), b: z.number() }).safeParse(args);
    let issues: unknown;
    try {
      tool.parseInput({ name: 'add', arguments: args });
    } catch (e) {
      issues = (e as z.ZodError).issues;
    }
    expect(issues).toEqual(expected.error?.issues);
  });

  it('builds the object schema once for a shape', () => {
    const tool = addTool();
    tool.parseInput({ name: 'add', arguments: { a: 1, b: 1 } });
    const first = builtSchema(tool);
    expect(first).toBeDefined();
    tool.parseInput({ name: 'add', arguments: { a: 2, b: 2 } });
    expect(builtSchema(tool)).toBe(first);
  });

  it('follows a replaced inputSchema', () => {
    const tool = addTool();
    expect(tool.parseInput({ name: 'add', arguments: { a: 2, b: 3 } })).toEqual({ a: 2, b: 3 });
    const first = builtSchema(tool);
    tool.inputSchema = { a: z.number(), b: z.number(), c: z.string() };
    expect(() => tool.parseInput({ name: 'add', arguments: { a: 2, b: 3 } })).toThrow(z.ZodError);
    expect(tool.parseInput({ name: 'add', arguments: { a: 2, b: 3, c: 'x' } })).toEqual({ a: 2, b: 3, c: 'x' });
    expect(builtSchema(tool)).not.toBe(first);
  });

  it('passes a raw JSON Schema tool its arguments through unchanged', () => {
    const tool = addTool({ rawInputSchema: { type: 'object' } } as Partial<ToolMetadata>);
    expect(tool.parseInput({ name: 'add', arguments: { a: '2', extra: true } })).toEqual({ a: '2', extra: true });
    expect(tool.parseInput({ name: 'add' })).toEqual({});
  });
});
