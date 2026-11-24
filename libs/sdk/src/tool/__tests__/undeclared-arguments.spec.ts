import { z } from '@frontmcp/lazy-zod';

import { findUndeclaredArguments, formatKeyPath } from '../undeclared-arguments';
import { describeUndeclaredArguments } from '../undeclared-arguments-message';

describe('findUndeclaredArguments', () => {
  const shape = {
    timeoutSec: z.number().optional(),
    filter: z.object({ status: z.string() }).optional(),
    lines: z.array(z.object({ sku: z.string() })).optional(),
    window: z
      .object({ from: z.string() })
      .transform(({ from }) => ({ start: from }))
      .optional(),
  };

  function undeclared(sent: Record<string, unknown>): string[][] {
    return findUndeclaredArguments(shape, sent, z.object(shape).parse(sent)).map((keyPath) => [...keyPath]);
  }

  it('names the top-level and nested keys parsing dropped, once per path', () => {
    const sent = {
      timeoutMs: 5,
      filter: { status: 'open', owner: 'me' },
      lines: [
        { sku: 'A', margin: 1 },
        { sku: 'B', margin: 2 },
      ],
    };

    expect(undeclared(sent)).toEqual([['filter', 'owner'], ['lines', '[]', 'margin'], ['timeoutMs']]);
  });

  it('names nothing when every key is declared', () => {
    expect(undeclared({ timeoutSec: 5, filter: { status: 'open' } })).toEqual([]);
  });

  it('compares nothing below a field whose schema transforms it', () => {
    expect(undeclared({ window: { from: 'monday', extra: true } })).toEqual([]);
  });

  it('compares nothing below a field a standalone z.transform() or a .catch() fallback replaces', () => {
    const replacingShape = {
      window: z.transform(() => ({ start: 'monday' })),
      filter: z.object({ status: z.string().optional() }).catch({}),
    };
    const sent = { window: { from: 'monday' }, filter: { status: 123 } };

    expect(findUndeclaredArguments(replacingShape, sent, z.object(replacingShape).parse(sent))).toEqual([]);
  });

  it('keeps a key whose name holds a dot or a bracket as one segment, not a path under a declared field', () => {
    expect(undeclared({ 'window.from': 'monday', 'lines[0]': 'x' })).toEqual([['lines[0]'], ['window.from']]);
  });
});

describe('formatKeyPath', () => {
  it('reads a key path as people write it', () => {
    expect(formatKeyPath(['lines', '[]', 'margin'])).toBe('lines[].margin');
  });
});

describe('describeUndeclaredArguments', () => {
  it('names the declared key closest to a slip', () => {
    expect(describeUndeclaredArguments([['timeoutMs']], ['timeoutSec', 'query'])).toBe(
      "'timeoutMs' (did you mean 'timeoutSec'?)",
    );
  });

  it('suggests nothing for a key far from every declared one, or for a nested key', () => {
    expect(describeUndeclaredArguments([['color'], ['filter', 'owner']], ['timeoutSec'])).toBe(
      "'color', 'filter.owner'",
    );
  });

  it('matches regardless of case', () => {
    expect(describeUndeclaredArguments([['UserId']], ['userId'])).toBe("'UserId' (did you mean 'userId'?)");
  });

  it('names the first 20 undeclared arguments and counts the rest', () => {
    const keyPaths = Array.from({ length: 23 }, (_, index) => [`extra${String(index).padStart(2, '0')}`]);

    const described = describeUndeclaredArguments(keyPaths, ['query']);

    expect(described.split(', ')).toHaveLength(20);
    expect(described.endsWith("'extra19' and 3 more")).toBe(true);
  });

  it('cuts a long key short and suggests nothing for it', () => {
    const longKey = `timeoutSec${'x'.repeat(100)}`;

    expect(describeUndeclaredArguments([[longKey]], ['timeoutSec'])).toBe(`'${longKey.slice(0, 64)}…'`);
  });
});
