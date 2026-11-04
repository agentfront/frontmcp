import { toLocationHeader } from '../http-location.utils';

describe('toLocationHeader', () => {
  it.each([
    ['a path', '/board'],
    ['a relative reference with a query and a fragment', '../board?view=week#today'],
    ['an absolute URL', 'https://desk.example.com/board?id=7'],
    ['a location with percent-encoded characters', '/board/%E6%9D%B1%E4%BA%AC?q=%2f'],
    ['the separators and sub-delimiters of a URL', "/a;b=c/d:e@f!$&'()*+,~|^[g]_-.?h=i#j"],
  ])('keeps %s as it is', (_case, location) => {
    expect(toLocationHeader(location)).toBe(location);
  });

  it('percent-encodes characters outside ASCII as UTF-8, and keeps the separators', () => {
    expect(toLocationHeader('/board/東京?city=Zürich#café')).toBe(
      '/board/%E6%9D%B1%E4%BA%AC?city=Z%C3%BCrich#caf%C3%A9',
    );
  });

  it('percent-encodes a character outside the Basic Multilingual Plane', () => {
    expect(toLocationHeader('/board/🚀')).toBe('/board/%F0%9F%9A%80');
  });

  it('percent-encodes whitespace and control characters, so they never reach the header', () => {
    expect(toLocationHeader('/my board\r\nSet-Cookie: a=b\x7f')).toBe('/my%20board%0D%0ASet-Cookie:%20a=b%7F');
  });

  it('percent-encodes the ASCII characters a URL does not carry, as Express does', () => {
    expect(toLocationHeader('/a"b<c>d`e{f}')).toBe('/a%22b%3Cc%3Ed%60e%7Bf%7D');
  });

  it.each([
    ['at the end', 'https://desk.example.com/items/100%', 'https://desk.example.com/items/100%25'],
    ['before a character that is not hexadecimal', '/a%zz', '/a%25zz'],
    ['before one hexadecimal digit', '/a%4g', '/a%254g'],
    ['before one hexadecimal digit at the end', '/a%4', '/a%254'],
    ['before a character outside ASCII', '/a%東', '/a%25%E6%9D%B1'],
  ])('percent-encodes a %% that starts no escape, %s', (_case, location, header) => {
    expect(toLocationHeader(location)).toBe(header);
  });

  it('sends a lone surrogate as U+FFFD', () => {
    expect(toLocationHeader('/board/\uD800')).toBe('/board/%EF%BF%BD');
  });
});
