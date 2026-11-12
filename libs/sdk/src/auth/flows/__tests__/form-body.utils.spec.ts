import { parseFormBody } from '../form-body.utils';

describe('parseFormBody', () => {
  it('collects a repeated field into one list, in order', () => {
    const body = Array.from({ length: 20_000 }, (_, index) => `tools=t${index}`).join('&');

    const parsed = parseFormBody(`${body}&email=a%40example.com`);

    expect(parsed['email']).toBe('a@example.com');
    expect(parsed['tools']).toHaveLength(20_000);
    expect((parsed['tools'] as string[]).slice(0, 3)).toEqual(['t0', 't1', 't2']);
  });

  it('keeps a field named __proto__ as a field', () => {
    const parsed = parseFormBody('__proto__=a&__proto__=b');

    expect(Object.keys(parsed)).toEqual(['__proto__']);
    expect(parsed['__proto__']).toEqual(['a', 'b']);
  });

  it('returns an object the Node host already parsed as it is', () => {
    const fields = { code: 'c1' };

    expect(parseFormBody(fields)).toBe(fields);
  });
});
