import { toLocationHeader } from '../http-location.utils';

describe('toLocationHeader', () => {
  it.each([
    ['a path', '/board'],
    ['a relative reference with a query and a fragment', '../board?view=week#today'],
    ['an absolute URL', 'https://desk.example.com/board?id=7'],
    ['a location with percent-encoded characters', '/board/%E6%9D%B1%E4%BA%AC'],
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
    expect(toLocationHeader('/my board\r\nSet-Cookie: a=b')).toBe('/my%20board%0D%0ASet-Cookie:%20a=b');
  });

  it('sends a lone surrogate as U+FFFD', () => {
    expect(toLocationHeader('/board/\uD800')).toBe('/board/%EF%BF%BD');
  });
});
