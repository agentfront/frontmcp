/**
 * Query parameters are serialized by their OpenAPI 3 `style` and `explode`.
 *
 * Up to 1.11.0 every array was sent comma-joined (`ids=1%2C2`), even with the default `form` style
 * and `explode: true`, where OpenAPI sends `ids=1&ids=2`, and an object was refused.
 */
import type { McpOpenAPITool, ParameterMapper } from 'mcp-from-openapi';

import { buildRequest } from '../openapi.utils';

const NO_SECURITY = { headers: {}, query: {}, cookies: {} };
const BASE_URL = 'https://api.example.com';

function queryOf(mapper: Partial<ParameterMapper>, value: unknown, security = NO_SECURITY): string {
  const tool: McpOpenAPITool = {
    name: 'listInvoices',
    description: 'List invoices',
    inputSchema: { type: 'object', properties: {} },
    mapper: [{ inputKey: 'param', key: 'ids', type: 'query', required: false, ...mapper }],
    metadata: { path: '/invoices', method: 'get', servers: [{ url: BASE_URL }] },
  };
  return new URL(buildRequest(tool, { param: value }, security, BASE_URL).url).search;
}

describe('buildRequest query serialization', () => {
  describe('an array', () => {
    it.each([
      ['no style or explode (form, exploded)', {}, '?ids=1&ids=2'],
      ['form, explode: true', { style: 'form', explode: true }, '?ids=1&ids=2'],
      ['explode: true without a style', { explode: true }, '?ids=1&ids=2'],
      ['form, explode: false', { style: 'form', explode: false }, '?ids=1%2C2'],
      ['explode: false without a style', { explode: false }, '?ids=1%2C2'],
      ['spaceDelimited (unexploded by default)', { style: 'spaceDelimited' }, '?ids=1+2'],
      ['spaceDelimited, explode: false', { style: 'spaceDelimited', explode: false }, '?ids=1+2'],
      ['pipeDelimited (unexploded by default)', { style: 'pipeDelimited' }, '?ids=1%7C2'],
      ['pipeDelimited, explode: false', { style: 'pipeDelimited', explode: false }, '?ids=1%7C2'],
      ['spaceDelimited, explode: true', { style: 'spaceDelimited', explode: true }, '?ids=1&ids=2'],
      ['pipeDelimited, explode: true', { style: 'pipeDelimited', explode: true }, '?ids=1&ids=2'],
    ])('with %s', (_case, mapper, expected) => {
      expect(queryOf(mapper, [1, 2])).toBe(expected);
    });

    it('is read back item by item when exploded', () => {
      expect(new URLSearchParams(queryOf({}, ['a,b', 'c'])).getAll('ids')).toEqual(['a,b', 'c']);
    });

    it('sends nothing when empty and exploded', () => {
      expect(queryOf({}, [])).toBe('');
    });

    it('refuses an item that is itself an array or an object', () => {
      expect(() => queryOf({}, [[1, 2]])).toThrow("query parameter 'ids' cannot be an array");
      expect(() => queryOf({}, [{ id: 1 }])).toThrow("query parameter 'ids' cannot be an object");
    });
  });

  describe('an object', () => {
    const filter = { status: 'open', currency: 'USD' };

    it.each([
      ['no style or explode (form, exploded)', {}, '?status=open&currency=USD'],
      ['form, explode: false', { style: 'form', explode: false }, '?ids=status%2Copen%2Ccurrency%2CUSD'],
      ['spaceDelimited', { style: 'spaceDelimited' }, '?ids=status+open+currency+USD'],
      ['pipeDelimited', { style: 'pipeDelimited' }, '?ids=status%7Copen%7Ccurrency%7CUSD'],
      ['deepObject', { style: 'deepObject', explode: true }, '?ids%5Bstatus%5D=open&ids%5Bcurrency%5D=USD'],
    ])('with %s', (_case, mapper, expected) => {
      expect(queryOf(mapper, filter)).toBe(expected);
    });

    it('sends deepObject properties as name[property]', () => {
      const params = new URLSearchParams(queryOf({ style: 'deepObject', explode: true }, filter));

      expect([...params.entries()]).toEqual([
        ['ids[status]', 'open'],
        ['ids[currency]', 'USD'],
      ]);
    });

    it('leaves out a property that is undefined', () => {
      expect(queryOf({}, { status: 'open', currency: undefined })).toBe('?status=open');
    });

    it('refuses a nested object', () => {
      expect(() => queryOf({ style: 'deepObject' }, { amount: { gte: 1 } })).toThrow(
        "query parameter 'ids' cannot be an object",
      );
    });
  });

  it('sends a primitive as one pair, whatever the style', () => {
    expect(queryOf({}, 7)).toBe('?ids=7');
    expect(queryOf({ style: 'pipeDelimited', explode: false }, 'a b')).toBe('?ids=a+b');
  });

  it('still refuses an exploded object property named like a security query parameter', () => {
    const security = { headers: {}, query: { api_key: 'secret' }, cookies: {} };

    expect(() => queryOf({}, { api_key: 'from-the-model' }, security)).toThrow(/Query parameter collision: 'api_key'/);
  });
});
