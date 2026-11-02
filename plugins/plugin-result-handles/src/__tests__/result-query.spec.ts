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

  it.each(['rows..title', 'rows[', 'rows[x]', '$rows', 'rows["a]'])('refuses %j', (path) => {
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
