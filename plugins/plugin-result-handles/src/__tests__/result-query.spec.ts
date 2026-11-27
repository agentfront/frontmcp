import { InvalidInputError } from '@frontmcp/sdk';

import { ResultPathNotFoundError } from '../result-handles.errors';
import { parseResultPath, queryResult } from '../result-query';

const result = {
  rows: Array.from({ length: 45 }, (_, id) => ({ id, title: `Row ${id}`, tags: ['a', 'b'] })),
  log: 'x'.repeat(2500),
  'odd.key': { 'a/b': { 'c~d': 1 } },
  total: 45,
};

describe('parseResultPath', () => {
  it.each([
    ['', []],
    ['$', []],
    ['rows', ['rows']],
    ['$.rows[2].title', ['rows', 2, 'title']],
    ['rows.2.title', ['rows', '2', 'title']],
    ['$["odd.key"]["a/b"]', ['odd.key', 'a/b']],
    ['/rows/2/title', ['rows', '2', 'title']],
    ['/odd.key/a~1b/c~0d', ['odd.key', 'a/b', 'c~d']],
    ['/', ['']],
  ])('reads %j', (path, segments) => {
    expect(parseResultPath(path)).toEqual(segments);
  });

  it.each(['rows..title', 'rows[', 'rows[x]', '$rows', 'rows["a]', '$["a\\x"]'])('refuses %j', (path) => {
    expect(() => parseResultPath(path)).toThrow(ResultPathNotFoundError);
  });
});

describe('queryResult', () => {
  it('reads the first 20 items of a list by default, with its length and the next offset', () => {
    const slice = queryResult(result, { path: 'rows' });
    expect(slice.path).toBe('rows');
    expect(slice.value).toHaveLength(20);
    expect(slice).toMatchObject({ total: 45, offset: 0, nextOffset: 20 });
  });

  it('reads a range of a list', () => {
    const slice = queryResult(result, { path: '$.rows', offset: 5, limit: 3 });
    expect((slice.value as Array<{ id: number }>).map((row) => row.id)).toEqual([5, 6, 7]);
    expect(slice).toMatchObject({ total: 45, offset: 5, nextOffset: 8 });
  });

  it('reads a page of limit items, the last one with no next offset', () => {
    const slice = queryResult(result, { path: '/rows', page: 3, limit: 20 });
    expect((slice.value as Array<{ id: number }>).map((row) => row.id)).toEqual([40, 41, 42, 43, 44]);
    expect(slice.offset).toBe(40);
    expect(slice.nextOffset).toBeUndefined();
  });

  it('refuses a page and an offset together', () => {
    expect(() => queryResult(result, { path: 'rows', page: 2, offset: 4 })).toThrow(InvalidInputError);
  });

  it('keeps only the listed fields of each object in a list, and of an object', () => {
    const slice = queryResult(result, { path: 'rows', limit: 2, fields: ['id', 'missing'] });
    expect(slice.value).toEqual([{ id: 0 }, { id: 1 }]);
    expect(queryResult(result, { path: 'rows[1]', fields: ['title'] }).value).toEqual({ title: 'Row 1' });
    expect(queryResult(result, { path: 'rows[1].tags', fields: ['title'] }).value).toEqual(['a', 'b']);
  });

  it('reads the characters of a string by range, 2000 by default', () => {
    expect(queryResult(result, { path: 'log' })).toMatchObject({ total: 2500, offset: 0, nextOffset: 2000 });
    const tail = queryResult(result, { path: 'log', offset: 2490 });
    expect(tail.value).toBe('x'.repeat(10));
    expect(tail.nextOffset).toBeUndefined();
  });

  it('reads an object or a value whole, with the whole result at $', () => {
    expect(queryResult(result, { path: '$["odd.key"]' }).value).toEqual({ 'a/b': { 'c~d': 1 } });
    expect(queryResult(result, { path: 'total' })).toEqual({ path: 'total', value: 45 });
    expect(queryResult({ a: 1 }, {})).toEqual({ path: '$', value: { a: 1 } });
  });

  it.each(['missing', 'rows[45]', 'rows.first', 'total.value', 'rows[0].__proto__'])(
    'answers a path with no value (%j) with ResultPathNotFoundError',
    (path) => {
      expect(() => queryResult(result, { path })).toThrow(ResultPathNotFoundError);
    },
  );
});

describe('queryResult views', () => {
  const orders = {
    orders: [
      { id: 1, status: 'open', total: 30, customer: { name: 'Ada' }, tags: ['rush'], note: 'Call before noon' },
      { id: 2, status: 'shipped', total: 120, customer: { name: 'Bob' }, tags: [], note: 'Left at the door' },
      { id: 3, status: 'open', total: 75, customer: { name: 'Cy' }, tags: ['gift', 'rush'], note: 'Gift wrap' },
      { id: 4, status: 'cancelled', total: 75, customer: { name: 'Di' }, tags: ['gift'] },
      { id: 5, status: 'open', total: 5, customer: { name: 'Ed' }, tags: [], note: 'Timeout on payment' },
    ],
    log: 'boot ok\nERROR disk full\nwarn retry 1\r\nerror timeout after 30s\ndone',
    total: 5,
  };
  const ids = (slice: { value: unknown }) => (slice.value as Array<{ id: number }>).map((order) => order.id);

  it('keeps the items that meet every where condition, total and next offset counting only those', () => {
    const slice = queryResult(orders, {
      path: 'orders',
      where: [
        { field: 'status', op: 'eq', value: 'open' },
        { field: 'total', op: 'gte', value: 10 },
      ],
    });
    expect(ids(slice)).toEqual([1, 3]);
    expect(slice).toMatchObject({ total: 2, offset: 0 });

    const page = queryResult(orders, {
      path: 'orders',
      where: [{ field: 'status', op: 'eq', value: 'open' }],
      limit: 2,
    });
    expect(page).toMatchObject({ total: 3, nextOffset: 2 });
  });

  it.each([
    [{ field: 'status', op: 'ne', value: 'open' }, [2, 4]],
    [{ field: 'total', op: 'gt', value: 75 }, [2]],
    [{ field: 'total', op: 'lt', value: 75 }, [1, 5]],
    [{ field: 'total', op: 'lte', value: 75 }, [1, 3, 4, 5]],
    [{ field: 'status', op: 'in', value: ['shipped', 'cancelled'] }, [2, 4]],
    [{ field: 'note', op: 'contains', value: 'at' }, [2]],
    [{ field: 'tags', op: 'contains', value: 'rush' }, [1, 3]],
    [{ field: 'customer.name', op: 'startsWith', value: 'B' }, [2]],
    [{ field: '$.customer.name', op: 'endsWith', value: 'y' }, [3]],
    [{ field: 'note', op: 'exists' }, [1, 2, 3, 5]],
    [{ field: 'note', op: 'exists', value: false }, [4]],
    [{ field: 'note', op: 'ne', value: 'Gift wrap' }, [1, 2, 4, 5]],
    [{ field: 'total', op: 'gt', value: '10' }, []],
    [{ field: 'tags[0]', op: 'eq', value: 'gift' }, [3, 4]],
  ] as const)('where %j keeps %j', (condition, kept) => {
    expect(ids(queryResult(orders, { path: 'orders', where: [condition as never] }))).toEqual(kept);
  });

  it('compares the item itself when a condition has no field', () => {
    expect(queryResult({ codes: [200, 404, 500, 404] }, { path: 'codes', where: [{ op: 'gte', value: 400 }] })).toEqual(
      {
        path: 'codes',
        value: [404, 500, 404],
        total: 3,
        offset: 0,
      },
    );
  });

  it.each([
    [{ op: 'in', value: 'open' }, 'where[0]: "in" takes a list of values'],
    [{ op: 'eq', value: ['open'] }, 'where[0]: "eq" takes a string, a number, a boolean or null'],
    [{ op: 'gt' }, 'where[0]: "gt" takes a string, a number, a boolean or null'],
    [{ op: 'exists', value: 'yes' }, 'where[0]: "exists" takes true, false or no value'],
  ])('refuses the condition %j', (condition, message) => {
    expect(() => queryResult(orders, { path: 'orders', where: [condition as never] })).toThrow(InvalidInputError);
    expect(() => queryResult(orders, { path: 'orders', where: [condition as never] })).toThrow(message);
  });

  it.each([
    [{ where: [{ field: 'a..b', op: 'exists' }] }, 'where[0].field "a..b"'],
    [{ grep: { pattern: 'x', field: 'a..b' } }, 'grep.field "a..b"'],
    [{ sort: [{ field: 'id' }, { field: 'a..b' }] }, 'sort[1].field "a..b"'],
  ])('refuses an item field that is not a path, %j, as a bad view', (view, option) => {
    const query = { path: 'orders', ...view } as never;

    expect(() => queryResult(orders, query)).toThrow(InvalidInputError);
    expect(() => queryResult(orders, query)).toThrow(`${option} is not a dot path or a JSON pointer`);
  });

  it('still answers a path that names nothing with ResultPathNotFoundError, and an absent field as missing', () => {
    expect(() => queryResult(orders, { path: 'missing', where: [{ op: 'exists' }] })).toThrow(ResultPathNotFoundError);
    expect(
      ids(queryResult(orders, { path: 'orders', where: [{ field: 'note', op: 'exists', value: false }] })),
    ).toEqual([4]);
  });

  it('runs where before grep on a list, so grep spends its steps on the items where keeps', () => {
    const long = 'y'.repeat(1_000);
    const items = [
      { id: 1, status: 'open', note: `${long}z` },
      ...Array.from({ length: 200 }, (_, index) => ({ id: index + 2, status: 'closed', note: long })),
      { id: 202, status: 'open', note: long },
    ];

    const slice = queryResult(
      { items },
      {
        path: 'items',
        where: [{ field: 'status', op: 'eq', value: 'open' }],
        grep: { pattern: '.{0,100}z', regex: true },
      },
    );

    expect(ids(slice)).toEqual([1]);
  });

  it('runs where on the { line, text } items of a string grep', () => {
    const slice = queryResult(orders, {
      path: 'log',
      grep: { pattern: 'r' },
      where: [{ field: 'line', op: 'gt', value: 3 }],
    });

    expect(slice.value).toEqual([{ line: 4, text: 'error timeout after 30s' }]);
  });

  it('refuses grep.field on a string, whose lines have no fields to search', () => {
    const query = { path: 'log', grep: { pattern: 'ERROR', field: 'line' } };

    expect(() => queryResult(orders, query)).toThrow(InvalidInputError);
    expect(() => queryResult(orders, query)).toThrow('grep.field');
  });

  it('sorts by several fields, keeping the order of equal items and putting items with no value last', () => {
    const byTotal = queryResult(orders, { path: 'orders', sort: [{ field: 'total', order: 'desc' }, { field: 'id' }] });
    expect(ids(byTotal)).toEqual([2, 3, 4, 1, 5]);
    expect(ids(queryResult(orders, { path: 'orders', sort: [{ field: 'note' }] }))).toEqual([1, 3, 2, 5, 4]);
    expect(ids(queryResult(orders, { path: 'orders', sort: [{ field: 'note', order: 'desc' }] }))).toEqual([
      5, 2, 3, 1, 4,
    ]);
    expect(queryResult({ mixed: ['b', 2, null, true, 'a', 1] }, { path: 'mixed', sort: [{}] }).value).toEqual([
      1,
      2,
      'a',
      'b',
      true,
      null,
    ]);
  });

  it('sorts before it reads a range, and keeps the fields asked for', () => {
    const slice = queryResult(orders, {
      path: 'orders',
      sort: [{ field: 'total' }],
      offset: 1,
      limit: 2,
      fields: ['id'],
    });
    expect(slice).toEqual({ path: 'orders', value: [{ id: 1 }, { id: 3 }], total: 5, offset: 1, nextOffset: 3 });
  });

  it('greps the strings and numbers of each item, or of one field', () => {
    expect(ids(queryResult(orders, { path: 'orders', grep: { pattern: 'gift', ignoreCase: true } }))).toEqual([3, 4]);
    expect(ids(queryResult(orders, { path: 'orders', grep: { pattern: '120' } }))).toEqual([2]);
    expect(ids(queryResult(orders, { path: 'orders', grep: { pattern: 'gift', field: 'note' } }))).toEqual([]);
    expect(
      ids(queryResult(orders, { path: 'orders', grep: { pattern: '^[A-C]', regex: true, field: 'customer' } })),
    ).toEqual([1, 2, 3]);
  });

  it('greps the lines of a string into { line, text } items', () => {
    const slice = queryResult(orders, { path: 'log', grep: { pattern: 'error', ignoreCase: true } });
    expect(slice).toEqual({
      path: 'log',
      value: [
        { line: 2, text: 'ERROR disk full' },
        { line: 4, text: 'error timeout after 30s' },
      ],
      total: 2,
      offset: 0,
    });
    const regex = queryResult(orders, { path: 'log', grep: { pattern: '\\d+s?$', regex: true }, fields: ['line'] });
    expect(regex.value).toEqual([{ line: 3 }, { line: 4 }]);
  });

  it('counts the items where and grep keep, in place of the items', () => {
    expect(queryResult(orders, { path: 'orders', count: true })).toEqual({ path: 'orders', value: 5 });
    expect(
      queryResult(orders, { path: 'orders', where: [{ field: 'status', op: 'eq', value: 'open' }], count: true }),
    ).toEqual({ path: 'orders', value: 3 });
    expect(queryResult(orders, { path: 'log', grep: { pattern: 'r' }, count: true })).toEqual({
      path: 'log',
      value: 2,
    });
  });

  it('reads a list and a string as before when no view is asked for', () => {
    expect(queryResult(orders, { path: 'orders', count: false, limit: 1 })).toMatchObject({ total: 5, nextOffset: 1 });
    expect(queryResult(orders, { path: 'log', limit: 4 })).toMatchObject({ value: 'boot', total: orders.log.length });
  });

  it.each([
    [{ path: 'total', where: [{ op: 'exists' }] }, '"total" is a number'],
    [{ path: 'log', sort: [{}] }, '"log" is a string'],
    [{ path: 'log', count: true }, '"log" is a string'],
    [{ path: '$', grep: { pattern: 'a' } }, '"$" is an object'],
  ])('refuses a view of a value that is not a list: %j', (query, problem) => {
    expect(() => queryResult(orders, query as never)).toThrow(InvalidInputError);
    expect(() => queryResult(orders, query as never)).toThrow(
      `where, sort and count read a list, and grep a list or the lines of a string: ${problem}`,
    );
  });
});
