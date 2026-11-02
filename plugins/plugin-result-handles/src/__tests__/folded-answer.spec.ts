import { z } from '@frontmcp/lazy-zod';

import { foldedAnswerSchema, previewOf, shapeOf } from '../folded-answer';

const limits = { items: 3, chars: 10 };

function nested(depth: number): unknown {
  return depth === 0 ? 'leaf' : { next: nested(depth - 1) };
}

describe('previewOf', () => {
  it('keeps the first list items and the first characters of strings, at every level', () => {
    const answer = {
      rows: Array.from({ length: 10 }, (_, id) => ({ id, body: `row ${id} `.padEnd(40, '.') })),
      title: 'Quarterly revenue report',
      total: 10,
      final: true,
      note: null,
    };

    expect(previewOf(answer, limits)).toEqual({
      rows: [
        { id: 0, body: 'row 0 ....' },
        { id: 1, body: 'row 1 ....' },
        { id: 2, body: 'row 2 ....' },
      ],
      title: 'Quarterly ',
      total: 10,
      final: true,
      note: null,
    });
  });

  it('leaves short lists and strings whole', () => {
    expect(previewOf(['a', 'b'], limits)).toEqual(['a', 'b']);
    expect(previewOf('short', limits)).toBe('short');
  });

  it('never splits a surrogate pair', () => {
    expect(previewOf('abcdefghi\u{1F600}xyz', limits)).toBe('abcdefghi');
  });

  it('keeps the first 50 keys of an object', () => {
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`key${index}`, index]));
    const preview = previewOf(wide, limits) as Record<string, number>;
    expect(Object.keys(preview)).toHaveLength(50);
    expect(preview['key49']).toBe(49);
  });

  it('empties lists and objects nested deeper than 8 levels', () => {
    expect(JSON.stringify(previewOf(nested(10), limits))).toBe(
      '{"next":{"next":{"next":{"next":{"next":{"next":{"next":{"next":{}}}}}}}}}',
    );
    expect(previewOf([[[[[[[[[1]]]]]]]]], limits)).toEqual([[[[[[[[[]]]]]]]]]);
  });
});

describe('shapeOf', () => {
  it('describes keys, types and list and string lengths', () => {
    const answer = { rows: [{ id: 1, title: 'ab' }], total: 1, missing: null, flag: true, empty: [] };

    expect(shapeOf(answer)).toEqual({
      type: 'object',
      keys: {
        rows: {
          type: 'array',
          length: 1,
          items: { type: 'object', keys: { id: { type: 'number' }, title: { type: 'string', length: 2 } } },
        },
        total: { type: 'number' },
        missing: { type: 'null' },
        flag: { type: 'boolean' },
        empty: { type: 'array', length: 0 },
      },
    });
  });

  it('lists the first 50 keys and counts the rest', () => {
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`key${index}`, index]));
    const shape = shapeOf(wide);
    expect(Object.keys(shape.keys ?? {})).toHaveLength(50);
    expect(shape.moreKeys).toBe(10);
  });

  it('stops describing below 8 levels', () => {
    let shape = shapeOf(nested(10));
    for (let level = 0; level < 8; level += 1) shape = shape.keys?.['next'] ?? { type: 'null' };
    expect(shape).toEqual({ type: 'object' });
    expect(JSON.stringify(shapeOf([[[[[[[[[1]]]]]]]]]))).toContain('{"type":"array","length":1}');
  });
});

describe('foldedAnswerSchema', () => {
  it('admits a folded answer as a member of a union output schema', () => {
    const report = z.object({ rows: z.array(z.number()), total: z.number() });
    const foldable = z.union([report, foldedAnswerSchema]);
    const folded = { preview: { rows: [1] }, shape: { type: 'object' }, handle: 'b9f2' };

    expect(foldable.parse(folded)).toEqual(folded);
    expect(report.safeParse(folded).success).toBe(false);
  });
});
