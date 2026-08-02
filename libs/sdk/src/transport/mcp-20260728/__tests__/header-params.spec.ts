import { buildParamHeaders, validateHeaderParams } from '../client/header-params';

const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties });

describe('validateHeaderParams', () => {
  it('accepts a well-formed annotation', () => {
    expect(validateHeaderParams(schema({ region: { type: 'string', 'x-mcp-header': 'Region' } }))).toEqual({
      valid: true,
    });
  });

  it('rejects an empty annotation', () => {
    // `collectHeaderParams` drops these, so validation has to walk the raw
    // annotations or this case would silently pass.
    const result = validateHeaderParams(schema({ region: { type: 'string', 'x-mcp-header': '' } }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('must not be empty');
  });

  it('rejects a case-insensitive duplicate', () => {
    // HTTP field names are case-insensitive, so `Region` and `region` would
    // collapse into one header.
    const result = validateHeaderParams(
      schema({
        a: { type: 'string', 'x-mcp-header': 'Region' },
        b: { type: 'string', 'x-mcp-header': 'region' },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('declared more than once');
  });

  it('rejects a non-token annotation name', () => {
    const result = validateHeaderParams(schema({ a: { type: 'string', 'x-mcp-header': 'bad name' } }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('field-name token');
  });

  it('rejects an annotation on a number', () => {
    const result = validateHeaderParams(schema({ a: { type: 'number', 'x-mcp-header': 'A' } }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('number');
  });

  it('rejects an annotation on a non-primitive', () => {
    const result = validateHeaderParams(schema({ a: { type: 'object', 'x-mcp-header': 'A' } }));
    expect(result.valid).toBe(false);
  });

  it('accepts integer and boolean annotations', () => {
    expect(
      validateHeaderParams(
        schema({ a: { type: 'integer', 'x-mcp-header': 'A' }, b: { type: 'boolean', 'x-mcp-header': 'B' } }),
      ),
    ).toEqual({ valid: true });
  });

  it('accepts a schema with no annotations at all', () => {
    expect(validateHeaderParams(schema({ a: { type: 'string' } }))).toEqual({ valid: true });
    expect(validateHeaderParams(undefined)).toEqual({ valid: true });
  });
});

describe('buildParamHeaders', () => {
  const identity = (v: string) => v;
  const s = schema({ region: { type: 'string', 'x-mcp-header': 'Region' } });

  it('mirrors a supplied argument', () => {
    expect(buildParamHeaders(s, { region: 'us-west1' }, identity)).toEqual({ 'Mcp-Param-Region': 'us-west1' });
  });

  it('omits the header when the argument is absent or null', () => {
    expect(buildParamHeaders(s, {}, identity)).toEqual({});
    expect(buildParamHeaders(s, { region: null }, identity)).toEqual({});
  });

  it('stringifies booleans and integers', () => {
    const bools = schema({ flag: { type: 'boolean', 'x-mcp-header': 'Flag' } });
    expect(buildParamHeaders(bools, { flag: false }, identity)).toEqual({ 'Mcp-Param-Flag': 'false' });

    const ints = schema({ n: { type: 'integer', 'x-mcp-header': 'N' } });
    expect(buildParamHeaders(ints, { n: 42 }, identity)).toEqual({ 'Mcp-Param-N': '42' });
  });

  it('skips numbers that cannot round-trip exactly', () => {
    const ints = schema({ n: { type: 'integer', 'x-mcp-header': 'N' } });
    expect(buildParamHeaders(ints, { n: 1.5 }, identity)).toEqual({});
    expect(buildParamHeaders(ints, { n: Number.MAX_SAFE_INTEGER + 10 }, identity)).toEqual({});
  });

  it('returns nothing for a schema with no annotations', () => {
    expect(buildParamHeaders(schema({ a: { type: 'string' } }), { a: 'x' }, identity)).toEqual({});
  });
});
