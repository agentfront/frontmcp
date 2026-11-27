import { z } from '@frontmcp/lazy-zod';

import { declaredKeysAt, findUndeclaredArguments, formatKeyPath } from '../undeclared-arguments';
import { describeUndeclaredArguments, undeclaredArgumentsWarning } from '../undeclared-arguments-message';

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

describe('declaredKeysAt', () => {
  const shape = {
    timeoutSec: z.number().optional(),
    filter: z.object({ status: z.string(), owner: z.object({ team: z.string() }).nullable() }).optional(),
    lines: z.array(z.object({ sku: z.string() })).default([]),
    target: z.union([z.object({ userId: z.string() }), z.object({ groupId: z.string() })]),
  };

  it('names the top-level keys for the top level', () => {
    expect(declaredKeysAt(shape, [])).toEqual(['timeoutSec', 'filter', 'lines', 'target']);
  });

  it('names the keys of a nested object below its optional, nullable and default wrappers', () => {
    expect(declaredKeysAt(shape, ['filter'])).toEqual(['status', 'owner']);
    expect(declaredKeysAt(shape, ['filter', 'owner'])).toEqual(['team']);
    expect(declaredKeysAt(shape, ['lines', '[]'])).toEqual(['sku']);
  });

  it('names the keys of every option of a union', () => {
    expect(declaredKeysAt(shape, ['target'])).toEqual(['userId', 'groupId']);
  });

  it('follows a recursive z.lazy() schema down to the level asked for', () => {
    type Folder = { name: string; folders: Folder[] };
    const folder: z.ZodType<Folder> = z.lazy(() => z.object({ name: z.string(), folders: z.array(folder) }));

    expect(declaredKeysAt({ root: folder }, ['root', 'folders', '[]', 'folders', '[]'])).toEqual(['name', 'folders']);
  });

  it('names no keys below a field that is not an object, or a key the schema does not declare', () => {
    expect(declaredKeysAt(shape, ['timeoutSec'])).toEqual([]);
    expect(declaredKeysAt(shape, ['lines'])).toEqual([]);
    expect(declaredKeysAt(shape, ['window'])).toEqual([]);
  });
});

describe('describeUndeclaredArguments', () => {
  const shape = {
    timeoutSec: z.number().optional(),
    query: z.string().optional(),
    filter: z.object({ status: z.string() }).optional(),
    lines: z.array(z.object({ sku: z.string() })).optional(),
  };

  it('names the declared key closest to a slip', () => {
    expect(describeUndeclaredArguments([['timeoutMs']], shape)).toBe("'timeoutMs' (did you mean 'timeoutSec'?)");
  });

  it('names the closest key declared beside a nested slip, as its whole path', () => {
    expect(
      describeUndeclaredArguments(
        [
          ['filter', 'stauts'],
          ['lines', '[]', 'SKU'],
        ],
        shape,
      ),
    ).toBe("'filter.stauts' (did you mean 'filter.status'?), 'lines[].SKU' (did you mean 'lines[].sku'?)");
  });

  it('suggests nothing for a key far from every key declared beside it', () => {
    expect(describeUndeclaredArguments([['color'], ['filter', 'owner'], ['lines', '[]', 'margin']], shape)).toBe(
      "'color', 'filter.owner', 'lines[].margin'",
    );
  });

  it('suggests a key declared at the same depth only, not one from another level', () => {
    expect(describeUndeclaredArguments([['filter', 'timeoutSecs']], shape)).toBe("'filter.timeoutSecs'");
  });

  it('matches regardless of case', () => {
    expect(describeUndeclaredArguments([['UserId']], { userId: z.string() })).toBe("'UserId' (did you mean 'userId'?)");
  });

  it('names the first 20 undeclared arguments and counts the rest', () => {
    const keyPaths = Array.from({ length: 23 }, (_, index) => [`extra${String(index).padStart(2, '0')}`]);

    const described = describeUndeclaredArguments(keyPaths, { query: z.string() });

    expect(described.split(', ')).toHaveLength(20);
    expect(described.endsWith("'extra19' and 3 more")).toBe(true);
  });

  it('cuts a long key short and suggests nothing for it', () => {
    const longKey = `timeoutSec${'x'.repeat(100)}`;

    expect(describeUndeclaredArguments([[longKey]], shape)).toBe(`'${longKey.slice(0, 64)}…'`);
  });
});

describe('undeclaredArgumentsWarning', () => {
  it('names the first 20 key paths, each cut to 64 characters, and counts the rest', () => {
    const keyPaths = Array.from({ length: 23 }, (_, index) => `${'k'.repeat(100)}${index}`);

    const warning = undeclaredArgumentsWarning('agent_wait', keyPaths);

    expect(warning).toContain(`${'k'.repeat(64)}…, `);
    expect(warning).not.toContain('k'.repeat(65));
    expect(warning).toContain(' and 3 more. Declare them');
    expect(warning.split('…')).toHaveLength(21);
  });
});
